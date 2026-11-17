const db = require('../models');
const bankAdapter = require('./plaid.adapter');
const secretsVault = require('./secrets.vault');

// ============================================================================
// SYNC WORKER
// Syncs accounts, balances, and transactions from Plaid API into PostgreSQL,
// tracking a syncCursor per enrollment and account via /transactions/sync.
// ============================================================================

// Helper: Fetch incremental transactions for a Plaid Item using cursor pagination
async function fetchItemTransactionsWithCursor(accessToken, initialCursor) {
  const addedOrModified = [];
  const removedIds = [];
  let cursor = initialCursor || null;
  const pageSize = 250;
  const maxPages = 4; // Up to 1,000 transactions per sync

  for (let page = 0; page < maxPages; page++) {
    const syncPage = await bankAdapter.syncTransactions(accessToken, cursor, pageSize);
    if (!syncPage) {
      break;
    }

    if (Array.isArray(syncPage.added)) {
      for (let i = 0; i < syncPage.added.length; i++) {
        addedOrModified.push(syncPage.added[i]);
      }
    }

    if (Array.isArray(syncPage.modified)) {
      for (let i = 0; i < syncPage.modified.length; i++) {
        addedOrModified.push(syncPage.modified[i]);
      }
    }

    if (Array.isArray(syncPage.removed)) {
      for (let i = 0; i < syncPage.removed.length; i++) {
        removedIds.push(syncPage.removed[i]);
      }
    }

    cursor = syncPage.nextCursor || cursor;

    if (!syncPage.hasMore) {
      break;
    }
  }

  return {
    transactions: addedOrModified,
    removedIds,
    nextCursor: cursor,
  };
}

// Sync all accounts, balances, and transactions for a single Plaid enrollment (Item)
async function syncEnrollmentData(enrollment, userId) {
  // Step 1: Decrypt the access_token from the Secrets Vault
  const accessToken = secretsVault.decryptToken(enrollment.accessToken);

  // Step 2: Fetch the user's accounts (and balances) from Plaid (/accounts/get)
  const plaidAccounts = await bankAdapter.getAccounts(accessToken);
  const accountList = Array.isArray(plaidAccounts) ? plaidAccounts : [];
  const defaultBankName = enrollment.institutionName || null;
  const todayStr = new Date().toISOString().slice(0, 10);

  // Build map of accountId -> account info for transaction association
  const accountMap = {};
  for (let i = 0; i < accountList.length; i++) {
    const acct = accountList[i];
    accountMap[acct.id] = acct;
  }

  // Step 3: Incrementally sync transactions using Plaid's /transactions/sync cursor
  let latestEnrollmentCursor = enrollment.syncCursor || null;
  try {
    const syncResult = await fetchItemTransactionsWithCursor(accessToken, latestEnrollmentCursor);
    latestEnrollmentCursor = syncResult.nextCursor || latestEnrollmentCursor;

    // Upsert added and modified transactions
    for (let i = 0; i < syncResult.transactions.length; i++) {
      const t = syncResult.transactions[i];
      if (!t || !t.id) {
        continue;
      }

      const matchedAccount = accountMap[t.account_id] || accountList[0] || {};
      const institutionName = defaultBankName || matchedAccount.institution?.name || null;

      await db.Transaction.upsert(
        {
          transactionId: t.id,
          accountId: t.account_id || matchedAccount.id || 'unknown',
          enrollmentId: enrollment.enrollmentId,
          userId,
          date: t.date || todayStr,
          description: t.description || 'Transaction',
          amount: parseFloat(t.amount) || 0,
          category: t.category || 'Uncategorized',
          accountName: matchedAccount.name || 'Account',
          institutionName,
        },
        { conflictFields: ['transaction_id'] }
      );
    }

    // Remove deleted transactions reported by Plaid
    if (syncResult.removedIds.length > 0) {
      await db.Transaction.destroy({
        where: {
          transactionId: syncResult.removedIds,
          userId,
        },
      });
    }
  } catch {
    // Allow account/balance sync to proceed even if transaction sync fails
  }

  // Step 4: Save or update each account + balance + syncCursor in PostgreSQL
  for (let i = 0; i < accountList.length; i++) {
    const plaidAccount = accountList[i];
    const existingAccount = await db.Account.findOne({
      where: { accountId: plaidAccount.id },
    });

    let balanceValue;
    const rawCurrent =
      plaidAccount.balances?.current ??
      plaidAccount.balances?.ledger ??
      plaidAccount.balances?.available;

    if (rawCurrent !== undefined && rawCurrent !== null) {
      balanceValue = parseFloat(rawCurrent) || 0;
    } else {
      try {
        const balances = await bankAdapter.getBalances(accessToken, plaidAccount.id);
        const rawBalance = balances?.current ?? balances?.ledger ?? balances?.available ?? 0;
        balanceValue = parseFloat(rawBalance) || 0;
      } catch {
        balanceValue = existingAccount ? parseFloat(existingAccount.balance) || 0 : 0;
      }
    }

    const institutionName = defaultBankName || plaidAccount.institution?.name || null;

    await db.Account.upsert(
      {
        accountId: plaidAccount.id,
        enrollmentId: enrollment.enrollmentId,
        userId,
        name: plaidAccount.name,
        lastFour: plaidAccount.last_four,
        type: plaidAccount.type,
        subtype: plaidAccount.subtype,
        institutionName,
        balance: balanceValue,
        syncCursor: latestEnrollmentCursor,
      },
      { conflictFields: ['account_id'] }
    );
  }

  // Step 5: Update the enrollment's syncCursor in PostgreSQL
  if (latestEnrollmentCursor && latestEnrollmentCursor !== enrollment.syncCursor) {
    await enrollment.update({ syncCursor: latestEnrollmentCursor });
  }

  return accountList;
}

// Sync all connected enrollments for a user
async function syncAllUserEnrollments(userId) {
  const enrollments = await db.Enrollment.findAll({
    where: { userId },
  });

  const syncedEnrollments = [];
  for (let i = 0; i < enrollments.length; i++) {
    const enrollment = enrollments[i];
    const accounts = await syncEnrollmentData(enrollment, userId);
    syncedEnrollments.push({
      enrollmentId: enrollment.enrollmentId,
      institutionName: enrollment.institutionName,
      syncCursor: enrollment.syncCursor,
      accountsSynced: accounts.length,
    });
  }

  return syncedEnrollments;
}

module.exports = {
  syncEnrollmentData,
  syncAllUserEnrollments,
};

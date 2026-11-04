const db = require('../models');
const bankAdapter = require('./teller.adapter');
const secretsVault = require('./secrets.vault');

// ============================================================================
// SYNC WORKER
// Syncs accounts, balances, and transactions from Teller API into PostgreSQL,
// tracking a syncCursor (latest transaction ID) per account and enrollment.
// ============================================================================

// Helper: Fetch new transactions for one account using Teller's cursor pagination (from_id)
async function fetchAccountTransactionsWithCursor(
  accessToken,
  accountId,
  previousCursor,
  startStr,
  endStr
) {
  const collectedTransactions = [];
  let pageCursor = null;
  const pageSize = 250;
  const maxPages = 4; // Up to 1,000 transactions per sync

  for (let page = 0; page < maxPages; page++) {
    const queryParams = {
      start_date: startStr,
      end_date: endStr,
      count: pageSize,
    };

    // In Teller API, from_id fetches transactions older than the given transaction ID
    if (pageCursor) {
      queryParams.from_id = pageCursor;
    }

    const pageItems = await bankAdapter.getTransactions(accessToken, accountId, queryParams);
    if (!Array.isArray(pageItems) || pageItems.length === 0) {
      break;
    }

    let reachedPreviousCursor = false;
    for (let i = 0; i < pageItems.length; i++) {
      const txn = pageItems[i];
      if (!txn || !txn.id) {
        continue;
      }

      // If we hit the transaction we already synced last time, we can stop paging older ones
      if (previousCursor && txn.id === previousCursor) {
        reachedPreviousCursor = true;
        break;
      }

      collectedTransactions.push(txn);
    }

    if (reachedPreviousCursor || pageItems.length < pageSize) {
      break;
    }

    // Set cursor to the last transaction ID in this page to fetch the next page
    const lastTxn = pageItems[pageItems.length - 1];
    pageCursor = lastTxn?.id || null;
    if (!pageCursor) {
      break;
    }
  }

  return collectedTransactions;
}

// Sync all accounts, balances, and transactions for a single Teller enrollment
async function syncEnrollmentData(enrollment, userId) {
  // Step 1: Decrypt the access_token from the Secrets Vault
  const accessToken = secretsVault.decryptToken(enrollment.accessToken);

  // Step 2: Fetch the user's accounts from Teller (GET /accounts)
  const tellerAccounts = await bankAdapter.getAccounts(accessToken);
  const accountList = Array.isArray(tellerAccounts) ? tellerAccounts : [];
  const defaultBankName = enrollment.institutionName || null;

  // Date window for syncing transactions (last 12 months)
  const now = new Date();
  const startDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = now.toISOString().slice(0, 10);

  let latestEnrollmentCursor = enrollment.syncCursor || null;

  for (let i = 0; i < accountList.length; i++) {
    const tellerAccount = accountList[i];

    // Look up existing account record so we can read its saved syncCursor
    const existingAccount = await db.Account.findOne({
      where: { accountId: tellerAccount.id },
    });
    const previousAccountCursor = existingAccount?.syncCursor || null;

    // Step 3: Fetch balance for this account from Teller (GET /accounts/:id/balances)
    let balanceValue;
    try {
      const balances = await bankAdapter.getBalances(accessToken, tellerAccount.id);
      const rawBalance = balances?.ledger ?? balances?.available ?? 0;
      balanceValue = parseFloat(rawBalance) || 0;
    } catch {
      balanceValue = existingAccount ? parseFloat(existingAccount.balance) || 0 : 0;
    }

    const institutionName = defaultBankName || tellerAccount.institution?.name || null;

    // Step 4: Fetch transactions from Teller (GET /accounts/:id/transactions)
    let newestAccountCursor = previousAccountCursor;
    try {
      const txns = await fetchAccountTransactionsWithCursor(
        accessToken,
        tellerAccount.id,
        previousAccountCursor,
        startStr,
        endStr
      );

      // Teller returns newest transactions first, so index 0 is the new sync cursor
      if (txns.length > 0 && txns[0].id) {
        newestAccountCursor = txns[0].id;
        latestEnrollmentCursor = txns[0].id;
      }

      // Save each transaction into the App Database
      for (let j = 0; j < txns.length; j++) {
        const t = txns[j];
        if (!t.id) {
          continue;
        }

        await db.Transaction.upsert(
          {
            transactionId: t.id,
            accountId: t.account_id || tellerAccount.id,
            enrollmentId: enrollment.enrollmentId,
            userId,
            date: t.date || endStr,
            description: t.description || 'Transaction',
            amount: parseFloat(t.amount) || 0,
            category: t.details?.category || 'Uncategorized',
            accountName: tellerAccount.name,
            institutionName,
          },
          { conflictFields: ['transaction_id'] }
        );
      }
    } catch {
      // If transactions fail for one account, continue syncing the remaining accounts
    }

    // Step 5: Save or update account + balance + syncCursor in PostgreSQL
    await db.Account.upsert(
      {
        accountId: tellerAccount.id,
        enrollmentId: enrollment.enrollmentId,
        userId,
        name: tellerAccount.name,
        lastFour: tellerAccount.last_four,
        type: tellerAccount.type,
        subtype: tellerAccount.subtype,
        institutionName,
        balance: balanceValue,
        syncCursor: newestAccountCursor,
      },
      { conflictFields: ['account_id'] }
    );
  }

  // Step 6: Update the enrollment's syncCursor in PostgreSQL
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

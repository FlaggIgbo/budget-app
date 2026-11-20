// Semantic Material Design 3 icon names for @angular/material <mat-icon>
// Maps bank account types/subtypes and transaction spending categories to
// standard Material icons (self-hosted locally in /fonts/material-icons.woff2).

export function getAccountIcon(type?: string | null, subtype?: string | null): string {
  const normalizedSubtype = (subtype || '').trim().toLowerCase();
  const normalizedType = (type || '').trim().toLowerCase();

  if (
    normalizedType === 'credit' ||
    normalizedSubtype.includes('credit') ||
    normalizedSubtype.includes('card')
  ) {
    return 'credit_card';
  }

  if (
    normalizedSubtype.includes('saving') ||
    normalizedSubtype.includes('money_market') ||
    normalizedSubtype === 'cd' ||
    normalizedSubtype === 'hsa'
  ) {
    return 'savings';
  }

  if (
    normalizedType === 'investment' ||
    normalizedSubtype.includes('brokerage') ||
    normalizedSubtype.includes('401k') ||
    normalizedSubtype.includes('ira') ||
    normalizedSubtype.includes('roth')
  ) {
    return 'trending_up';
  }

  if (
    normalizedType === 'loan' ||
    normalizedSubtype.includes('mortgage') ||
    normalizedSubtype.includes('loan')
  ) {
    return 'request_quote';
  }

  // Default for checking / depository bank accounts
  return 'account_balance';
}

export function getCategoryIcon(category?: string | null, amount?: number): string {
  const normalized = (category || '').trim().toLowerCase();

  if (
    (typeof amount === 'number' && amount > 0) ||
    normalized.includes('income') ||
    normalized.includes('payroll') ||
    normalized.includes('deposit')
  ) {
    return 'payments';
  }

  if (
    normalized.includes('rent') ||
    normalized.includes('housing') ||
    normalized.includes('mortgage') ||
    normalized.includes('home')
  ) {
    return 'home';
  }

  if (
    normalized.includes('utilit') ||
    normalized.includes('electric') ||
    normalized.includes('water') ||
    normalized.includes('internet')
  ) {
    return 'bolt';
  }

  if (
    normalized.includes('food') ||
    normalized.includes('drink') ||
    normalized.includes('dining') ||
    normalized.includes('restaurant') ||
    normalized.includes('coffee') ||
    normalized.includes('grocer')
  ) {
    return 'restaurant';
  }

  if (
    normalized.includes('transport') ||
    normalized.includes('gas') ||
    normalized.includes('auto') ||
    normalized.includes('transit')
  ) {
    return 'directions_car';
  }

  if (
    normalized.includes('travel') ||
    normalized.includes('flight') ||
    normalized.includes('hotel')
  ) {
    return 'flight';
  }

  if (
    normalized.includes('entertainment') ||
    normalized.includes('recreation') ||
    normalized.includes('movie') ||
    normalized.includes('music')
  ) {
    return 'movie';
  }

  if (
    normalized.includes('health') ||
    normalized.includes('medical') ||
    normalized.includes('pharmacy')
  ) {
    return 'local_hospital';
  }

  if (
    normalized.includes('education') ||
    normalized.includes('school') ||
    normalized.includes('tuition')
  ) {
    return 'school';
  }

  if (normalized.includes('subscription') || normalized.includes('bill')) {
    return 'subscriptions';
  }

  return 'shopping_bag';
}

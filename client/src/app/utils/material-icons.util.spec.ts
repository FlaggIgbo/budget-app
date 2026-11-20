import { getAccountIcon, getCategoryIcon } from './material-icons.util';

describe('Material Icons Utility (Semantic M3 Icons)', () => {
  it('maps bank account types and subtypes to semantic Material icons', () => {
    expect(getAccountIcon('depository', 'checking')).toBe('account_balance');
    expect(getAccountIcon('depository', 'savings')).toBe('savings');
    expect(getAccountIcon('credit', 'credit_card')).toBe('credit_card');
    expect(getAccountIcon('investment', 'brokerage')).toBe('trending_up');
    expect(getAccountIcon('loan', 'mortgage')).toBe('request_quote');
    expect(getAccountIcon(undefined, undefined)).toBe('account_balance');
  });

  it('maps transaction categories and positive income amounts to semantic Material icons', () => {
    expect(getCategoryIcon('Income', 3225)).toBe('payments');
    expect(getCategoryIcon('General', 500)).toBe('payments');
    expect(getCategoryIcon('Rent And Utilities', -1850)).toBe('home');
    expect(getCategoryIcon('Food And Drink', -142.8)).toBe('restaurant');
    expect(getCategoryIcon('Transportation', -60)).toBe('directions_car');
    expect(getCategoryIcon('Entertainment', -25)).toBe('movie');
    expect(getCategoryIcon('General Merchandise', -94.2)).toBe('shopping_bag');
    expect(getCategoryIcon(undefined, -10)).toBe('shopping_bag');
  });
});

// User model
export interface User {
  id: string;
  phone: string;
}

// Bank account model
export interface BankAccount {
  id: string;
  name: string;
  lastFour: string;
  balance: number;
  isAsset: boolean;
  institutionName?: string | null;
}

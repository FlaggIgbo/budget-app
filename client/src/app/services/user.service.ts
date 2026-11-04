import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

export interface UserProfile {
  id: string;
  email: string;
}

// Feature service for user profile operations
@Injectable({ providedIn: 'root' })
export class UserService {
  constructor(
    private api: ApiService,
    private auth: AuthService
  ) {}

  // Load current user's profile
  getProfile(): Observable<UserProfile> {
    return this.api.get<UserProfile>('/profile');
  }

  // Log user out
  logout(): Observable<{ ok: boolean }> {
    return this.auth.logout();
  }
}

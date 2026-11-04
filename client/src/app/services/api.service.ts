import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

// Helper service to send HTTP requests to the backend API
@Injectable({
  providedIn: 'root',
})
export class ApiService {
  private readonly baseUrl = '/api';
  private readonly options = { withCredentials: true };

  constructor(private http: HttpClient) {}

  // GET request
  get<T>(path: string): Observable<T> {
    return this.http.get<T>(`${this.baseUrl}${path}`, this.options);
  }

  // POST request
  post<T>(path: string, body: unknown): Observable<T> {
    return this.http.post<T>(`${this.baseUrl}${path}`, body, this.options);
  }

  // DELETE request
  delete<T>(path: string): Observable<T> {
    return this.http.delete<T>(`${this.baseUrl}${path}`, this.options);
  }
}

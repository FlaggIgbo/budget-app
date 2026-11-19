import { Injectable } from '@angular/core';

export interface PasskeyCreationOptionsJSON {
  challenge: string;
  rp: { name: string; id: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: 'public-key'; alg: number }[];
  timeout?: number;
  attestation?: AttestationConveyancePreference;
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  excludeCredentials?: {
    id: string;
    type: 'public-key';
    transports?: AuthenticatorTransport[];
  }[];
}

export interface PasskeyRequestOptionsJSON {
  challenge: string;
  rpId?: string;
  timeout?: number;
  userVerification?: UserVerificationRequirement;
  allowCredentials?: {
    id: string;
    type: 'public-key';
    transports?: AuthenticatorTransport[];
  }[];
}

export interface SerializedRegistrationCredential {
  id: string;
  rawId: string;
  type: string;
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: string[];
    publicKey?: string;
    publicKeyAlgorithm?: number;
    authenticatorData?: string;
  };
}

export interface SerializedAuthenticationCredential {
  id: string;
  rawId: string;
  type: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle: string | null;
  };
}

export type OtpTransport = 'sms' | 'email';

export interface OtpCredential extends Credential {
  readonly code?: string;
}

export interface OtpCredentialRequestOptions extends CredentialRequestOptions {
  otp: {
    transport: OtpTransport[];
  };
}

// Browser Credential Management helper wrapping WebAuthn passkeys and WebOTP
// (navigator.credentials.create() and navigator.credentials.get())
@Injectable({ providedIn: 'root' })
export class WebAuthnService {
  isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof PublicKeyCredential !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      Boolean(navigator.credentials) &&
      typeof navigator.credentials.create === 'function' &&
      typeof navigator.credentials.get === 'function'
    );
  }

  isOtpSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'OTPCredential' in window &&
      typeof navigator !== 'undefined' &&
      Boolean(navigator.credentials) &&
      typeof navigator.credentials.get === 'function'
    );
  }

  base64UrlToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (base64.length % 4)) % 4;
    const binary = atob(base64 + '='.repeat(padLen));
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  arrayBufferToBase64Url(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  // Create a new passkey using the WebAuthn navigator.credentials.create() API
  async createPasskey(
    options: PasskeyCreationOptionsJSON
  ): Promise<SerializedRegistrationCredential> {
    if (!this.isSupported()) {
      const err = new Error('Passkeys are not supported in this browser.');
      err.name = 'NotSupportedError';
      throw err;
    }

    const publicKey: PublicKeyCredentialCreationOptions = {
      challenge: this.base64UrlToUint8Array(options.challenge),
      rp: options.rp,
      user: {
        id: this.base64UrlToUint8Array(options.user.id),
        name: options.user.name,
        displayName: options.user.displayName,
      },
      pubKeyCredParams: options.pubKeyCredParams,
      timeout: options.timeout ?? 60000,
      attestation: options.attestation ?? 'none',
      authenticatorSelection: options.authenticatorSelection,
      excludeCredentials: options.excludeCredentials?.map((cred) => ({
        id: this.base64UrlToUint8Array(cred.id),
        type: cred.type,
        transports: cred.transports,
      })),
    };

    const credential = (await navigator.credentials.create({
      publicKey,
    })) as PublicKeyCredential | null;

    if (!credential) {
      const err = new Error('Passkey creation was cancelled.');
      err.name = 'NotAllowedError';
      throw err;
    }

    const attestationResponse = credential.response as AuthenticatorAttestationResponse;
    const responsePayload: SerializedRegistrationCredential['response'] = {
      clientDataJSON: this.arrayBufferToBase64Url(attestationResponse.clientDataJSON),
      attestationObject: this.arrayBufferToBase64Url(attestationResponse.attestationObject),
    };

    if (typeof attestationResponse.getTransports === 'function') {
      responsePayload.transports = attestationResponse.getTransports();
    }
    if (typeof attestationResponse.getPublicKey === 'function') {
      const pubKeyBuf = attestationResponse.getPublicKey();
      if (pubKeyBuf) {
        responsePayload.publicKey = this.arrayBufferToBase64Url(pubKeyBuf);
      }
    }
    if (typeof attestationResponse.getPublicKeyAlgorithm === 'function') {
      responsePayload.publicKeyAlgorithm = attestationResponse.getPublicKeyAlgorithm();
    }
    if (typeof attestationResponse.getAuthenticatorData === 'function') {
      const authDataBuf = attestationResponse.getAuthenticatorData();
      if (authDataBuf) {
        responsePayload.authenticatorData = this.arrayBufferToBase64Url(authDataBuf);
      }
    }

    return {
      id: credential.id,
      rawId: this.arrayBufferToBase64Url(credential.rawId),
      type: credential.type,
      response: responsePayload,
    };
  }

  // Authenticate with an existing passkey using navigator.credentials.get()
  async getPasskey(
    options: PasskeyRequestOptionsJSON
  ): Promise<SerializedAuthenticationCredential> {
    if (!this.isSupported()) {
      const err = new Error('Passkeys are not supported in this browser.');
      err.name = 'NotSupportedError';
      throw err;
    }

    const publicKey: PublicKeyCredentialRequestOptions = {
      challenge: this.base64UrlToUint8Array(options.challenge),
      rpId: options.rpId,
      timeout: options.timeout ?? 60000,
      userVerification: options.userVerification ?? 'preferred',
      allowCredentials: options.allowCredentials?.map((cred) => ({
        id: this.base64UrlToUint8Array(cred.id),
        type: cred.type,
        transports: cred.transports,
      })),
    };

    const credential = (await navigator.credentials.get({
      publicKey,
    })) as PublicKeyCredential | null;

    if (!credential) {
      const err = new Error('Passkey authentication was cancelled.');
      err.name = 'NotAllowedError';
      throw err;
    }

    const assertionResponse = credential.response as AuthenticatorAssertionResponse;

    return {
      id: credential.id,
      rawId: this.arrayBufferToBase64Url(credential.rawId),
      type: credential.type,
      response: {
        clientDataJSON: this.arrayBufferToBase64Url(assertionResponse.clientDataJSON),
        authenticatorData: this.arrayBufferToBase64Url(assertionResponse.authenticatorData),
        signature: this.arrayBufferToBase64Url(assertionResponse.signature),
        userHandle: assertionResponse.userHandle
          ? this.arrayBufferToBase64Url(assertionResponse.userHandle)
          : null,
      },
    };
  }

  // Listen for an incoming OTP via WebOTP API:
  // navigator.credentials.get({ otp: { transport: ['sms'] | ['email'] }, signal })
  async receiveOtp(
    transport: OtpTransport | OtpTransport[],
    signal?: AbortSignal
  ): Promise<string | null> {
    if (!this.isOtpSupported()) {
      return null;
    }

    const transports: OtpTransport[] = Array.isArray(transport) ? transport : [transport];
    try {
      const options: OtpCredentialRequestOptions = {
        otp: { transport: transports },
        ...(signal ? { signal } : {}),
      };
      const credential = (await navigator.credentials.get(options)) as OtpCredential | null;
      const code = credential?.code?.trim();
      return code || null;
    } catch {
      // Gracefully fall back to manual OTP entry on AbortError, timeout, or unsupported transport
      return null;
    }
  }
}

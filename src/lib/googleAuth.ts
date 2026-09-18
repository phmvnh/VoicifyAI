import { invoke } from "@tauri-apps/api/core";

export interface GoogleUser {
  id: string;
  name: string;
  email: string;
  picture: string | null;
}

export interface GoogleAuthStatus {
  configured: boolean;
  user: GoogleUser | null;
}

export function getGoogleAuthStatus(): Promise<GoogleAuthStatus> {
  return invoke<GoogleAuthStatus>("google_auth_status");
}

export function signInWithGoogle(): Promise<GoogleUser> {
  return invoke<GoogleUser>("google_sign_in");
}

export function cancelGoogleSignIn(): Promise<boolean> {
  return invoke<boolean>("google_cancel_sign_in");
}

export function signOutGoogle(): Promise<void> {
  return invoke("google_sign_out");
}

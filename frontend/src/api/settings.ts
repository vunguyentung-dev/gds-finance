import { apiClient } from './client';

export interface Profile {
  name: string;
  broker: string;
  account: string;
}

export function getProfile() {
  return apiClient.get<Profile>('fin/profile');
}

export function saveProfile(patch: Partial<Profile>) {
  return apiClient.post<Profile>('fin/profile', patch);
}

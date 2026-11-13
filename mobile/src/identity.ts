import AsyncStorage from '@react-native-async-storage/async-storage';

// Sign-up is out of scope, so each install invents an identity once and keeps
// it. It has to be stable: "don't match me again" is stored against this id.

export interface Identity {
  id: string;
  name: string;
}

const KEY = 'fluffle.identity.v1';
const NAMES = ['Mina', 'Theo', 'Asha', 'Luca', 'Noor', 'Iris', 'Kofi', 'Rosa', 'Jun', 'Elif', 'Omar', 'Vera'];
export const MAX_NAME = 20;

function invent(): Identity {
  const id = `u_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return { id, name: NAMES[Math.floor(Math.random() * NAMES.length)] };
}

export async function loadIdentity(): Promise<Identity> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Identity>;
      if (typeof parsed.id === 'string' && typeof parsed.name === 'string') return { id: parsed.id, name: parsed.name };
    }
  } catch {
    // Unreadable storage: fall through to a fresh identity.
  }
  const fresh = invent();
  void saveIdentity(fresh);
  return fresh;
}

export async function saveIdentity(identity: Identity): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(identity));
  } catch {
    // Not fatal: the identity still works for this launch.
  }
}

export function cleanName(input: string, fallback: string): string {
  const name = input.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return name || fallback;
}

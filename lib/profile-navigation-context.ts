'use client';
import { createContext } from 'react';
// Only dialogs containing the clicked profile link should close. An unrelated
// call or player dialog must never receive an imperative close as a side effect.
export const ProfileLinkDialogs = createContext<readonly (() => void)[]>([]);

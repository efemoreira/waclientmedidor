/**
 * Conversation storage utilities for persisting conversations
 * Supports both local file storage and Upstash Redis
 */

import { promises as fs } from 'fs';
import type { Conversation } from '../inbox/ConversationManager';

const APP_NAMESPACE = process.env.APP_NAMESPACE || 'waclientmedidor';
const CONVERSATIONS_FILE = `/tmp/${APP_NAMESPACE}_conversations.json`;
const CONVERSATIONS_META_FILE = `/tmp/${APP_NAMESPACE}_conversations.meta.json`;
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const UPSTASH_KEY = `${APP_NAMESPACE}:conversations`;
const UPSTASH_META_KEY = `${APP_NAMESPACE}:meta`;

/**
 * Check if Upstash Redis is configured
 */
export function isUpstashConfigured(): boolean {
  return Boolean(UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN);
}

/**
 * Read conversations from storage (Upstash or file)
 */
export async function lerConversas(): Promise<Record<string, Conversation> | null> {
  // Try Upstash first if configured
  if (isUpstashConfigured()) {
    try {
      const url = `${UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(UPSTASH_KEY)}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
      });
      if (!res.ok) {
        console.warn(`⚠️  Erro de resposta do Upstash ao ler conversas: status ${res.status} ${res.statusText || ''}`.trim());
        throw new Error(`Upstash GET failed: ${res.status}`);
      }
      const data: any = await res.json();
      if (data?.result != null) {
        const raw = data.result;
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
      }
    } catch (err: any) {
      console.warn('⚠️  Erro ao ler Upstash:', err?.message || err);
    }
  }

  // Fallback to file storage
  try {
    const content = await fs.readFile(CONVERSATIONS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.log('📝 Nenhuma conversa anterior encontrada');
    return null;
  }
}

/**
 * Save conversations to storage (Upstash and file)
 */
export async function salvarConversas(data: Record<string, Conversation>): Promise<void> {
  const json = JSON.stringify(data);

  // Save to Upstash if configured
  if (isUpstashConfigured()) {
    try {
      const url = `${UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(UPSTASH_KEY)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
        },
        body: json,
      });
      if (!res.ok) {
        throw new Error(`Upstash SET failed: ${res.status}`);
      }
    } catch (err: any) {
      console.warn('⚠️  Erro ao salvar no Upstash:', err?.message || err);
    }
  }

  // Always save to file as backup
  try {
    await fs.writeFile(CONVERSATIONS_FILE, json, 'utf-8');
  } catch (err: any) {
    console.error('❌ Erro ao salvar arquivo:', err?.message || err);
  }
}

/**
 * Read metadata from storage
 */
export async function lerMeta(): Promise<{ resetAt?: number }> {
  // Try Upstash first
  if (isUpstashConfigured()) {
    try {
      const url = `${UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(UPSTASH_META_KEY)}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
      });
      if (!res.ok) {
        console.warn(
          `⚠️  Erro de resposta do Upstash ao ler meta: status ${res.status} ${res.statusText || ''}`.trim(),
        );
      } else {
        const data: any = await res.json();
        if (data?.result != null) {
          const raw = data.result;
          return typeof raw === 'string' ? JSON.parse(raw) : raw;
        }
      }
    } catch (err: any) {
      console.warn('⚠️  Erro ao ler meta do Upstash:', err?.message || err);
    }
  }

  // Fallback to file
  try {
    const content = await fs.readFile(CONVERSATIONS_META_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Save metadata to storage
 */
export async function salvarMeta(meta: { resetAt: number }): Promise<void> {
  const json = JSON.stringify(meta);

  // Save to Upstash
  if (isUpstashConfigured()) {
    try {
      const url = `${UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(UPSTASH_META_KEY)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
        },
        body: json,
      });
      if (!res.ok) {
        throw new Error(`Upstash SET failed: ${res.status}`);
      }
    } catch (err: any) {
      console.warn('⚠️  Erro ao salvar meta no Upstash:', err?.message || err);
    }
  }

  // Save to file
  try {
    await fs.writeFile(CONVERSATIONS_META_FILE, json, 'utf-8');
  } catch (err: any) {
    console.error('❌ Erro ao salvar meta em arquivo:', err?.message || err);
  }
}

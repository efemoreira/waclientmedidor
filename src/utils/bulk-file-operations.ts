/**
 * File operations for bulk messaging status management
 */

import { promises as fs } from 'fs';

const STATUS_FILE = '/tmp/bulk-status.json';
const STOP_FILE = '/tmp/bulk-stop.json';
const QUEUE_FILE = '/tmp/bulk-queue.json';

export interface BulkStatus {
  ativo: boolean;
  total: number;
  enviados: number;
  erros: number;
  loteAtual: number;
  totalLotes: number;
  template: string;
  language: string;
  timestamp: number;
  lastErrors?: Array<{ numero: string; erro: string; at: number }>;
  interrompido?: boolean;
  mensagem?: string;
  lastRequests?: Array<{ url: string; payload: any; at: number }>;
  filaTotal?: number;
  filaIndex?: number;
}

export const defaultStatus: BulkStatus = {
  ativo: false,
  total: 0,
  enviados: 0,
  erros: 0,
  loteAtual: 0,
  totalLotes: 0,
  template: '',
  language: 'pt_BR',
  timestamp: Date.now(),
  lastErrors: [],
  interrompido: false,
  mensagem: '',
  lastRequests: [],
  filaTotal: 0,
  filaIndex: 0,
};

/**
 * Read bulk status from file
 */
export async function lerStatus(): Promise<BulkStatus> {
  try {
    const data = await fs.readFile(STATUS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return defaultStatus;
  }
}

/**
 * Save bulk status to file
 */
export async function salvarStatus(status: BulkStatus): Promise<void> {
  await fs.writeFile(STATUS_FILE, JSON.stringify(status, null, 2));
}

/**
 * Save queue to file
 */
export async function salvarFila(payload: { contatos: any[]; index: number }): Promise<void> {
  await fs.writeFile(QUEUE_FILE, JSON.stringify(payload, null, 2));
}

/**
 * Read queue from file
 */
export async function lerFila(): Promise<{ contatos: any[]; index: number } | null> {
  try {
    const data = await fs.readFile(QUEUE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Save stop flag to file
 */
export async function salvarStop(flag: boolean): Promise<void> {
  await fs.writeFile(STOP_FILE, JSON.stringify({ stop: flag, at: Date.now() }));
}

/**
 * Check if stop flag is set
 */
export async function deveParar(): Promise<boolean> {
  try {
    const data = await fs.readFile(STOP_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    return Boolean(parsed?.stop);
  } catch {
    return false;
  }
}

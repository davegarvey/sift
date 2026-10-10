import type { Scope } from '../../sync/auth';
import type { Schema } from './schema';

export class ToolError extends Error {}

export interface ToolContext {
  db: D1Database;
  pollDb?: D1Database;
  syncKey: string;
  tokenId: string;
  scopes: readonly Scope[];
}

export interface ToolResult {
  data: Record<string, unknown>;
  text: string;
}

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  scope: Scope;
  needsPoll?: boolean;
  inputSchema: Schema;
  outputSchema: Schema;
  annotations: ToolAnnotations;
  run(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;
}

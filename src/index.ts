#!/usr/bin/env node
/** stdio entry point: `npx emaki-mcp`. */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

await createServer().connect(new StdioServerTransport());

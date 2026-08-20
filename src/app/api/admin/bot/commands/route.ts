import { z } from 'zod';
import { requireAdmin } from '@/features/admin/auth';
import { deleteBotCommand, listBotCommands, upsertBotCommand } from '@/features/admin/server';
import { botCommandSchema } from '@/features/admin/schema';
import { apiError, assertSameOrigin, noStoreJson } from '@/lib/security/http';
export const runtime='nodejs';
export async function GET(){try{await requireAdmin();return noStoreJson({ok:true,commands:await listBotCommands()});}catch(error){return apiError(error,403)}}
export async function POST(request:Request){try{assertSameOrigin(request);const admin=await requireAdmin();const cmd=botCommandSchema.parse(await request.json());return noStoreJson({ok:true,command:await upsertBotCommand(admin,cmd)});}catch(error){return apiError(error,403)}}
export async function DELETE(request:Request){try{assertSameOrigin(request);const admin=await requireAdmin();const {command}=z.object({command:z.string().regex(/^[a-z0-9_]{1,32}$/)}).parse(await request.json());await deleteBotCommand(admin,command);return noStoreJson({ok:true});}catch(error){return apiError(error,403)}}

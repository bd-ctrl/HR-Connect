import { env } from 'cloudflare:workers';
import { loginAPI } from '../../../lib/login-api';
export const dynamic='force-dynamic';
export function GET(request:Request){return loginAPI(request,env)}
export function POST(request:Request){return loginAPI(request,env)}

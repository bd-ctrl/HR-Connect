import shell from "../lib/shell";
export const dynamic="force-dynamic";
export function GET(){return new Response(shell,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"private, no-store"}})}

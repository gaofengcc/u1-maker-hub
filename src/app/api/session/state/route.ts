import { NextResponse } from "next/server";
import { connection } from "next/server";
import { passwordVersion } from "@/lib/auth";

/**
 * 供 middleware（Edge Runtime，读不了文件）查询"当前密码版本号"。
 * pwv 只是 scrypt 哈希的前 4 字节，且盐不公开，无法据此反推或爆破密码。
 */
export async function GET() {
  // 每次请求都读文件，不能预渲染（项目开了 cacheComponents，用 connection() 声明动态）。
  await connection();
  return NextResponse.json(
    { pwv: passwordVersion() },
    { headers: { "cache-control": "no-store" } },
  );
}

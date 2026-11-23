import { NextResponse } from "next/server";
import { removePlateEntry, updatePlateEntry, type PlateChange } from "@/lib/plate.ts";
import { readJson } from "@/lib/http.ts";

/** Changes the size, rotation, orientation, number of copies, U1 plate or colours → toolheads of one model on the plate. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/plate/[id]">) {
  const { id } = await ctx.params;
  return NextResponse.json(updatePlateEntry(id, await readJson<PlateChange>(req)));
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/plate/[id]">) {
  const { id } = await ctx.params;
  return NextResponse.json(removePlateEntry(id));
}

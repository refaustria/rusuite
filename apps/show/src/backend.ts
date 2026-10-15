// The Show backend type (ADR 0005 §4): the shared `Backend` with Show's
// generated wire types.

import type { Backend } from "@rusuite/ui-shared";
import type { Request } from "./generated/Request";
import type { ResponseBody } from "./generated/ResponseBody";

export type ShowBackend = Backend<Request, ResponseBody>;

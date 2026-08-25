import { createMcpEndpoint } from "../../../_shared/mcp-endpoint"
import { createTemplatesServer } from "../../../_shared/mcp-servers"

export const onRequest = createMcpEndpoint(createTemplatesServer)

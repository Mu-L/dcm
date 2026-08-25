import { McpServer } from "@modelcontextprotocol/server"
import { z } from "zod"

import {
  generateComposeContent,
  generateEnvFile,
} from "../../lib/docker-compose/generators"
import type { DockerTool } from "../../lib/docker-tools"
import { getToolsFromTemplate, templates } from "../../lib/templates"
import { tools } from "../../tools"

const composeSettingsSchema = z.object({
  configPath: z.string().optional(),
  containerNamePrefix: z.string().optional(),
  dataPath: z.string().optional(),
  networkMode: z.string().optional(),
  pgid: z.string().optional(),
  puid: z.string().optional(),
  restartPolicy: z.string().optional(),
  timezone: z.string().optional(),
  umask: z.string().optional(),
})

const defaultComposeSettings = {
  configPath: "/opt/appdata/config",
  containerNamePrefix: "",
  dataPath: "/opt/appdata/data",
  networkMode: "bridge",
  pgid: "1000",
  puid: "1000",
  restartPolicy: "unless-stopped",
  timezone: "UTC",
  umask: "022",
}

/** Create a named MCP server with the shared DCM v2 version. */
function createServer(name: string): McpServer {
  return new McpServer({
    name,
    version: "2.0.0",
  })
}

/** Return the public catalog fields for one Docker tool. */
function summarizeTool(tool: DockerTool) {
  return {
    category: tool.category,
    description: tool.description,
    githubUrl: tool.githubUrl,
    id: tool.id,
    isUnsupported: tool.isUnsupported,
    name: tool.name,
    stars: tool.stars,
    tags: tool.tags,
  }
}

/** Create the stateless MCP server that exposes Docker tool discovery. */
export function createToolsServer(): McpServer {
  const server = createServer("dcm-tools")

  server.registerTool(
    "list_docker_tools",
    {
      description: "List the Docker tools available in Docker Compose Maker.",
      inputSchema: z.object({
        category: z.string().optional(),
        search: z.string().optional(),
      }),
    },
    async ({ category, search }) => {
      const normalizedSearch = search?.trim().toLowerCase()
      const matchingTools = tools.filter((tool) => {
        if (
          category &&
          tool.category.toLowerCase() !== category.toLowerCase()
        ) {
          return false
        }

        if (!normalizedSearch) return true

        return [tool.id, tool.name, tool.description, ...tool.tags]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch)
      })

      return {
        content: [
          {
            text: JSON.stringify(matchingTools.map(summarizeTool)),
            type: "text",
          },
        ],
        structuredContent: {
          tools: matchingTools.map(summarizeTool),
        },
      }
    },
  )

  server.registerTool(
    "get_docker_tool",
    {
      description:
        "Get a Docker tool definition, including its Compose content.",
      inputSchema: z.object({
        id: z.string().min(1),
      }),
    },
    async ({ id }) => {
      const tool = tools.find((candidate) => candidate.id === id)

      if (!tool) {
        return {
          content: [{ text: `Unknown Docker tool: ${id}`, type: "text" }],
          isError: true,
        }
      }

      return {
        content: [{ text: JSON.stringify(tool), type: "text" }],
        structuredContent: { ...tool },
      }
    },
  )

  return server
}

/** Create the stateless MCP server that exposes template discovery. */
export function createTemplatesServer(): McpServer {
  const server = createServer("dcm-templates")

  server.registerTool(
    "list_templates",
    {
      description: "List the predefined Docker Compose templates.",
      inputSchema: z.object({
        category: z.string().optional(),
        search: z.string().optional(),
      }),
    },
    async ({ category, search }) => {
      const normalizedSearch = search?.trim().toLowerCase()
      const matchingTemplates = templates.filter((template) => {
        if (
          category &&
          template.category.toLowerCase() !== category.toLowerCase()
        ) {
          return false
        }

        if (!normalizedSearch) return true

        return [template.id, template.name, template.description]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch)
      })

      return {
        content: [
          {
            text: JSON.stringify(matchingTemplates),
            type: "text",
          },
        ],
        structuredContent: {
          templates: matchingTemplates,
        },
      }
    },
  )

  server.registerTool(
    "get_template",
    {
      description: "Get a predefined template and its Docker tool definitions.",
      inputSchema: z.object({
        id: z.string().min(1),
      }),
    },
    async ({ id }) => {
      const template = templates.find((candidate) => candidate.id === id)

      if (!template) {
        return {
          content: [{ text: `Unknown template: ${id}`, type: "text" }],
          isError: true,
        }
      }

      const templateTools = getToolsFromTemplate(template, tools)
      const result = {
        ...template,
        tools: templateTools,
      }

      return {
        content: [{ text: JSON.stringify(result), type: "text" }],
        structuredContent: result,
      }
    },
  )

  return server
}

/** Create the stateless MCP server that generates Compose and env content. */
export function createComposeServer(): McpServer {
  const server = createServer("dcm-compose")

  server.registerTool(
    "generate_compose",
    {
      description:
        "Generate docker-compose.yaml and .env content for selected Docker tool IDs.",
      inputSchema: z.object({
        settings: composeSettingsSchema.optional(),
        showInterpolated: z.boolean().optional(),
        toolIds: z.array(z.string().min(1)).min(1).max(50),
      }),
    },
    async ({ settings, showInterpolated, toolIds }) => {
      const seenToolIds = new Set<string>()
      const duplicateToolIds: string[] = []
      for (const id of toolIds) {
        if (seenToolIds.has(id)) {
          duplicateToolIds.push(id)
          continue
        }

        seenToolIds.add(id)
      }

      if (duplicateToolIds.length > 0) {
        return {
          content: [
            {
              text: `Duplicate Docker tool IDs: ${duplicateToolIds.join(", ")}`,
              type: "text",
            },
          ],
          isError: true,
        }
      }

      const selectedTools = toolIds.map((id) =>
        tools.find((tool) => tool.id === id),
      )
      const missingToolIds = toolIds.filter(
        (id, index) => !selectedTools[index],
      )

      if (missingToolIds.length > 0) {
        return {
          content: [
            {
              text: `Unknown Docker tool IDs: ${missingToolIds.join(", ")}`,
              type: "text",
            },
          ],
          isError: true,
        }
      }

      const composeSettings = {
        ...defaultComposeSettings,
        ...settings,
      }
      const { content, portConflicts } = generateComposeContent(
        selectedTools as DockerTool[],
        composeSettings,
        showInterpolated ?? false,
      )
      const result = {
        compose: content,
        env: generateEnvFile(selectedTools as DockerTool[], composeSettings),
        portConflicts,
      }

      return {
        content: [{ text: JSON.stringify(result), type: "text" }],
        structuredContent: result,
      }
    },
  )

  return server
}

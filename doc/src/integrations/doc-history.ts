import type { AstroIntegration } from "astro";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { settings } from "../config/settings";
import { collectContentFiles, getDocHistory } from "../utils/doc-history";

/** Build list of [localeKey | null, absoluteDir] pairs from settings */
function getContentDirEntries(): Array<[string | null, string]> {
  const entries: Array<[string | null, string]> = [
    [null, resolve(settings.docsDir)],
  ];
  if (settings.locales) {
    for (const [key, locale] of Object.entries(settings.locales)) {
      entries.push([key, resolve(locale.dir)]);
    }
  }
  return entries;
}

/** Find the matching content file for a slug across all content directories */
function findFileForSlug(
  slug: string,
  localeKey: string | null,
): { filePath: string; slug: string } | null {
  const dirEntries = getContentDirEntries();
  const targetEntry = dirEntries.find(([key]) => key === localeKey);
  if (!targetEntry) return null;

  const [, contentDir] = targetEntry;
  const files = collectContentFiles(contentDir);
  return files.find((f) => f.slug === slug) ?? null;
}

export function docHistoryIntegration(): AstroIntegration {
  return {
    name: "doc-history",
    hooks: {
      "astro:config:setup": ({ updateConfig, command, logger }) => {
        if (command !== "dev") return;

        logger.info("Serving /doc-history/* inline (on-demand git queries)");

        updateConfig({
          vite: {
            plugins: [
              {
                name: "doc-history-dev",
                configureServer(server) {
                  server.middlewares.use((req, res, next) => {
                    const url = req.url ?? "";
                    // Match /doc-history/*.json requests (with optional base path prefix)
                    if (!url.includes("/doc-history/")) {
                      next();
                      return;
                    }

                    // Extract the path starting from /doc-history/
                    const idx = url.indexOf("/doc-history/");
                    const jsonPath = url.slice(idx + "/doc-history/".length);

                    if (!jsonPath.endsWith(".json")) {
                      next();
                      return;
                    }

                    // Parse locale and slug from path
                    const pathWithoutExt = jsonPath.replace(/\.json$/, "");
                    let localeKey: string | null = null;
                    let slug: string;

                    // Check if the path starts with a known locale key
                    const localeKeys = Object.keys(settings.locales ?? {});
                    const firstSegment = pathWithoutExt.split("/")[0];
                    if (localeKeys.includes(firstSegment)) {
                      localeKey = firstSegment;
                      slug = pathWithoutExt.slice(firstSegment.length + 1);
                    } else {
                      slug = pathWithoutExt;
                    }

                    const file = findFileForSlug(slug, localeKey);
                    if (!file) {
                      res.statusCode = 404;
                      res.setHeader("Content-Type", "application/json");
                      res.end(JSON.stringify({ error: "Not found" }));
                      return;
                    }

                    try {
                      const history = getDocHistory(file.filePath, file.slug);
                      res.setHeader("Content-Type", "application/json");
                      res.setHeader("Access-Control-Allow-Origin", "*");
                      res.end(JSON.stringify(history));
                    } catch (err) {
                      const msg = err instanceof Error ? err.message : String(err);
                      logger.warn(`Doc history generation failed for ${slug}: ${msg}`);
                      res.statusCode = 500;
                      res.setHeader("Content-Type", "application/json");
                      res.end(JSON.stringify({ error: msg }));
                    }
                  });
                },
              },
            ],
          },
        });
      },

      "astro:build:done": async ({ dir, logger }) => {
        // CI uses SKIP_DOC_HISTORY=1 to skip inline generation
        if (process.env.SKIP_DOC_HISTORY === "1") {
          logger.info("Skipping doc history generation (SKIP_DOC_HISTORY=1)");
          return;
        }

        const outDir = fileURLToPath(dir);
        const historyDir = join(outDir, "doc-history");
        mkdirSync(historyDir, { recursive: true });

        const dirEntries = getContentDirEntries();
        let totalFiles = 0;

        for (const [localeKey, contentDir] of dirEntries) {
          const files = collectContentFiles(contentDir);
          for (const { filePath, slug } of files) {
            try {
              const history = getDocHistory(filePath, slug);
              const prefixedSlug = localeKey ? `${localeKey}/${slug}` : slug;
              const jsonPath = join(historyDir, `${prefixedSlug}.json`);
              mkdirSync(dirname(jsonPath), { recursive: true });
              writeFileSync(jsonPath, JSON.stringify(history));
              totalFiles++;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              logger.warn(`Skipped history for ${slug}: ${msg}`);
            }
          }
        }

        logger.info(
          `Generated doc history for ${totalFiles} files in doc-history/`,
        );
      },
    },
  };
}

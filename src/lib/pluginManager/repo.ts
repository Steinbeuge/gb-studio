import fetch from "node-fetch";
import settings from "electron-settings";
import {
  isPluginRepositoryEntry,
  PluginRepositoryEntry,
  PluginRepositoryMetadata,
} from "./types";
import { Value } from "@sinclair/typebox/value";
import { checksumString } from "lib/helpers/checksum";
import { join, dirname, relative } from "path";
import l10n from "shared/lib/lang/l10n";
import { createWriteStream, remove } from "fs-extra";
import getTmp from "lib/helpers/getTmp";
import AdmZip from "adm-zip";
import rimraf from "rimraf";
import { promisify } from "util";
import confirmDeletePlugin from "lib/electron/dialog/confirmDeletePlugin";
import { removeEmptyFoldersBetweenPaths } from "lib/helpers/fs/removeEmptyFoldersBetweenPaths";
import { satisfies } from "semver";
import confirmIncompatiblePlugin from "lib/electron/dialog/confirmIncompatiblePlugin";
import { dialog } from "electron";

const rmdir = promisify(rimraf);

declare const VERSION: string;

export const corePluginRepository: PluginRepositoryEntry = {
  id: "core",
  name: "GB Studio",
  url: "http://127.0.0.1:9999/repository.json",
};

const cache: {
  value: PluginRepositoryMetadata[];
  timestamp: number;
} = {
  value: [],
  timestamp: 0,
};
const oneHour = 60 * 60 * 1000;

export const getReposList = (): PluginRepositoryEntry[] => {
  const userRepositories: PluginRepositoryEntry[] = [];
  const storedUserRepositories: unknown = settings.get("plugins:repositories");
  if (Array.isArray(storedUserRepositories)) {
    for (const entry of storedUserRepositories) {
      if (isPluginRepositoryEntry(entry)) {
        userRepositories.push(entry);
      }
    }
  }
  return [corePluginRepository, ...userRepositories];
};

export const getGlobalPluginsList = async (force?: boolean) => {
  const now = new Date().getTime();
  if (!force && cache.timestamp > now) {
    return cache.value;
  }
  const reposList = getReposList();
  const repos: PluginRepositoryMetadata[] = [];
  for (const repo of reposList) {
    try {
      const data = await (await fetch(repo.url)).json();
      const castData = Value.Cast(PluginRepositoryMetadata, data);
      repos.push({
        ...castData,
        id: checksumString(repo.url),
        url: repo.url,
      });
    } catch (e) {
      dialog.showErrorBox(l10n("ERROR_PLUGIN_REPOSITORY_NOT_FOUND"), String(e));
    }
  }
  cache.value = repos;
  cache.timestamp = now + oneHour;
  return repos;
};

export const getRepoUrlById = (id: string): string | undefined => {
  const reposList = getReposList();
  return reposList.find((repo) => checksumString(repo.url) === id)?.url;
};

export const addPluginToProject = async (
  projectPath: string,
  pluginId: string,
  repoId: string
) => {
  try {
    const repoURL = getRepoUrlById(repoId);
    if (!repoURL) {
      throw new Error(l10n("ERROR_PLUGIN_REPOSITORY_NOT_FOUND"));
    }
    const repoRoot = dirname(repoURL);
    const repos = await getGlobalPluginsList();
    const repo = repos?.find((r) => r.id === repoId);
    if (!repo) {
      throw new Error(l10n("ERROR_PLUGIN_REPOSITORY_NOT_FOUND"));
    }
    const plugin = repo.plugins.find((p) => p.id === pluginId);
    if (!plugin) {
      throw new Error(l10n("ERROR_PLUGIN_NOT_FOUND"));
    }

    // Remove -rc* to treat release candidates as identical
    // to releases when confirming plugins are compatible
    // (alpha and beta versions will always warn)
    const releaseVersion = VERSION.replace(/-rc.*/, "");

    if (plugin.gbsVersion && !satisfies(releaseVersion, plugin.gbsVersion)) {
      const cancel = confirmIncompatiblePlugin(
        releaseVersion,
        plugin.gbsVersion
      );
      if (cancel) {
        return;
      }
    }

    const pluginURL =
      plugin.filename.startsWith("http:") ||
      plugin.filename.startsWith("https:")
        ? plugin.filename
        : join(repoRoot, plugin.filename);

    const outputPath = join(dirname(projectPath), "plugins", pluginId);

    const res = await fetch(pluginURL);

    const tmpDir = getTmp();
    const tmpPluginZipPath = join(
      tmpDir,
      `${checksumString(`${repoId}::${pluginId}`)}.zip`
    );

    const fileStream = createWriteStream(tmpPluginZipPath);
    await new Promise((resolve, reject) => {
      res.body?.pipe(fileStream);
      res.body?.on("error", reject);
      fileStream.on("finish", resolve);
    });

    // Extract plugin
    const zip = new AdmZip(tmpPluginZipPath);
    zip.extractAllTo(outputPath, true);

    // Remove tmp files
    await remove(tmpPluginZipPath);

    return outputPath;
  } catch (e) {
    dialog.showErrorBox(l10n("ERROR_UNABLE_TO_INSTALL_PLUGIN"), String(e));
  }
};

export const removePluginFromProject = async (
  projectPath: string,
  pluginId: string
) => {
  const projectRoot = dirname(projectPath);
  const pluginsPath = join(projectRoot, "plugins");
  const outputPath = join(pluginsPath, pluginId);
  const cancel = confirmDeletePlugin(
    pluginId,
    relative(projectRoot, outputPath)
  );
  if (cancel) {
    return;
  }
  await rmdir(outputPath);
  await removeEmptyFoldersBetweenPaths(pluginsPath, dirname(outputPath));
};

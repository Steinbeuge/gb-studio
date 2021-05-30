import glob from "glob";
import { promisify } from "util";
import { pathExists, readFile, writeFile } from "fs-extra";
import Path from "path";
import l10n from "../helpers/l10n";

const globAsync = promisify(glob);

export default async (
  buildRoot,
  { customColorsEnabled, sgb, musicDriver, profile, platform, batteryless }
) => {
  const cmds = platform === "win32" ? [""] : ["#!/bin/bash", "set -e"];
  const objFiles = [];

  const CC =
    platform === "win32"
      ? `..\\_gbstools\\gbdk\\bin\\lcc`
      : `../_gbstools/gbdk/bin/lcc`;
  let CFLAGS = `-Iinclude -Wa-Iinclude -Wa-I../_gbstools/gbdk/lib/small/asxxxx -Wl-a -c`;

  if (customColorsEnabled) {
    CFLAGS += " -DCGB";
  }

  if (sgb) {
    CFLAGS += " -DSGB";
  }

  if (musicDriver === "huge") {
    CFLAGS += " -DHUGE_TRACKER";
  } else {
    CFLAGS += " -DGBT_PLAYER";
  }

  if (batteryless) {
    CFLAGS += " -DBATTERYLESS";
  }

  if (profile) {
    CFLAGS += " -Wf--profile";
  }

  const srcRoot = `${buildRoot}/src/**/*.@(c|s)`;
  const buildFiles = await globAsync(srcRoot);

  const addCommand = (label, cmd) => {
    if (platform === "win32") {
      cmds.push(`@echo ${label}`);
      cmds.push(`@${cmd}`);
    } else {
      cmds.push(`echo "${label}"`);
      cmds.push(cmd);
    }
  };

  for (const file of buildFiles) {
    if (musicDriver === "huge" && file.indexOf("GBT_PLAYER") !== -1) {
      continue;
    }
    if (musicDriver !== "huge" && file.indexOf("HUGE_TRACKER") !== -1) {
      continue;
    }

    const objFile = `${file
      .replace(/src.*\//, "obj/")
      .replace(/\.[cs]$/, "")}.o`;

    if (!(await pathExists(objFile))) {
      addCommand(
        `${l10n("COMPILER_COMPILING")}: ${Path.relative(buildRoot, file)}`,
        `${CC} ${CFLAGS} -c -o ${Path.relative(
          buildRoot,
          objFile
        )} ${Path.relative(buildRoot, file)}`
      );
    }
    objFiles.push(objFile);
  }

  return cmds.join("\n");
};

export const buildPackFile = async (buildRoot) => {
  const output = [];
  const srcRoot = `${buildRoot}/src/**/*.@(c|s)`;
  const buildFiles = await globAsync(srcRoot);
  for (const file of buildFiles) {
    const objFile = `${file
      .replace(/src.*\//, "obj/")
      .replace(/\.[cs]$/, "")}.o`;

    output.push(objFile);
  }
  return output.join("\n");
};

export const buildLinkFile = async (buildRoot, cartSize) => {
  const output = [`-g __start_save=${cartSize - 4}`];
  const srcRoot = `${buildRoot}/src/**/*.@(c|s)`;
  const buildFiles = await globAsync(srcRoot);
  for (const file of buildFiles) {
    const objFile = `${file
      .replace(/src.*\//, "obj/")
      .replace(/\.[cs]$/, "")}.rel`;

    output.push(objFile);
  }
  return output.join("\n");
};

export const buildPackFlags = (packFilePath, batteryless = false) => {
  return [].concat(
    // General
    ["-b", 5, "-f", 255, "-e", "rel", "-c"],
    // Batteryless
    batteryless ? ["-a 4"] : [],
    // Input
    ["-i", packFilePath]
  );
};

export const buildLinkFlags = (
  linkFile,
  name = "GBSTUDIO",
  cartType,
  color = false,
  sgb = false,
  musicDriver = "gbtplayer"
) => {
  const validName = name
    .toUpperCase()
    .replace(/[^A-Z]*/g, "")
    .substring(0, 15);
  const cart = cartType === "mbc3" ? "0x10" : "0x1B";
  return [].concat(
    // General
    [
      `-Wm-yt${cart}`,
      "-Wm-yoA",
      "-Wm-ya4",
      "-Wl-j",
      "-Wl-m",
      "-Wl-w",
      "-Wm-yS",
      "-Wl-klib",
      "-Wl-g_shadow_OAM2=0xDF00",
      "-Wl-g.STACK=0xDF00",
      "-Wi-e",
      `-Wm-yn"${validName}"`,
    ],
    // Color
    color ? ["-Wm-yC"] : [],
    // SGB
    sgb ? ["-Wm-ys"] : [],
    musicDriver === "huge"
      ? // hugetracker
        ["-Wl-lhUGEDriver.lib"]
      : // gbtplayer
        ["-Wl-lgbt_player.lib"],
    // Output
    ["-o", "build/rom/game.gb", `-Wl-f${linkFile}`]
  );
};

export const makefileInjectToolsPath = async (filename, buildToolsPath) => {
  const makefile = await readFile(filename, "utf8");
  const updatedMakefile = makefile.replace(
    /GBSTOOLS_DIR =.*/,
    `GBSTOOLS_DIR = ${Path.normalize(buildToolsPath)}`
  );
  await writeFile(filename, updatedMakefile);
};

export const buildMakeDotBuildFile = ({
  cartType = "mbc5",
  color = false,
  sgb = false,
  batteryless = false,
  musicDriver = "gbtplayer",
}) => {
  return (
    `settings: ` +
    []
      .concat(
        color ? ["CGB"] : ["DMG"],
        sgb ? ["SGB"] : [],
        musicDriver === "huge" ? ["hUGE"] : ["GBT"],
        cartType === "mbc3" ? ["MBC3"] : ["MBC5"],
        batteryless ? ["batteryless"] : []
      )
      .join(" ")
  );
};

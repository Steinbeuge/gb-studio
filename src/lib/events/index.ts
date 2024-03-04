import glob from "glob";
import fs from "fs";
import plugins, { pluginEmitter } from "lib/plugins/plugins";
import {
  engineFieldsEmitter,
  EngineFieldSyncResult,
} from "lib/project/engineFields";
import {
  eventsRoot,
  EVENT_ENGINE_FIELD_SET,
  EVENT_ENGINE_FIELD_STORE,
} from "consts";
import * as l10n from "shared/lib/lang/l10n";
import * as eventHelpers from "./helpers";
import * as gbStudioHelpers from "lib/helpers/gbstudio";
import * as eventSystemHelpers from "lib/helpers/eventSystem";
import * as compileEntityEvents from "lib/compiler/compileEntityEvents";
import trimLines from "shared/lib/helpers/trimlines";
import type { ScriptEventFieldSchema } from "shared/lib/entities/entitiesTypes";
import { Dictionary } from "@reduxjs/toolkit";
import { clone, cloneDictionary } from "lib/helpers/clone";
const VM2 = __non_webpack_require__("vm2");
const NodeVM = VM2.NodeVM;

export interface EventHandler {
  id: string;
  autoLabel?: (
    lookup: (key: string) => string,
    args: Record<string, unknown>
  ) => string;
  fields: ScriptEventFieldSchema[];
  name?: string;
  description?: string;
  groups?: string[] | string;
  deprecated?: boolean;
  isConditional?: boolean;
  editableSymbol?: boolean;
  compile: (input: unknown, helpers: unknown) => void;
}

const internalEventHandlerPaths = glob.sync(`${eventsRoot}/event*.js`);

const vm = new NodeVM({
  timeout: 1000,
  sandbox: {},
  require: {
    mock: {
      "./helpers": eventHelpers,
      "../helpers/l10n": l10n,
      "../helpers/gbstudio": gbStudioHelpers,
      "../helpers/eventSystem": eventSystemHelpers,
      "../compiler/compileEntityEvents": compileEntityEvents,
      "../helpers/trimlines": trimLines, // @TODO Add deprecated warning when using this import
      "shared/lib/helpers/trimlines": trimLines,
    },
  },
});

const eventHandlers: Dictionary<EventHandler> = {};

// Plain old Javascript object versions of event handlers.
// These are safe for passing into web workers
// Where VM2 proxied objects cannot be used
// Only primitive types can be accessed, function types will be undefined
export const pojoEventHandlers = cloneDictionary(eventHandlers);
export const pojoEngineFieldUpdateEvents = cloneDictionary(eventHandlers);
export const pojoEngineFieldStoreEvents: Dictionary<EventHandler> = {};

// Stores event handlers for Engine Field events
export const engineFieldUpdateEvents: Dictionary<EventHandler> = {};
export const engineFieldStoreEvents: Dictionary<EventHandler> = {};

pluginEmitter.on("update-event", (plugin: EventHandler) => {
  eventHandlers[plugin.id] = plugin;
  pojoEventHandlers[plugin.id] = clone(plugin);
});

pluginEmitter.on("add-event", (plugin: EventHandler) => {
  eventHandlers[plugin.id] = plugin;
  pojoEventHandlers[plugin.id] = clone(plugin);
});

pluginEmitter.on("remove-event", (plugin: EventHandler) => {
  delete eventHandlers[plugin.id];
  delete pojoEventHandlers[plugin.id];
});

engineFieldsEmitter.on("sync", (res: EngineFieldSyncResult) => {
  const fieldUpdateHandler = eventHandlers[EVENT_ENGINE_FIELD_SET];
  const fieldStoreHandler = eventHandlers[EVENT_ENGINE_FIELD_STORE];

  if (!fieldUpdateHandler || !fieldStoreHandler) {
    return;
  }

  Object.keys(res.schemaLookup).forEach((key) => {
    const { update: updateValueField, store: storeValueField } =
      res.schemaLookup[key];
    engineFieldUpdateEvents[key] = {
      ...fieldUpdateHandler,
      fields: ([] as ScriptEventFieldSchema[]).concat(
        fieldUpdateHandler.fields || [],
        updateValueField
      ),
    };

    engineFieldStoreEvents[key] = {
      ...fieldStoreHandler,
      fields: ([] as ScriptEventFieldSchema[]).concat(
        fieldStoreHandler.fields || [],
        storeValueField
      ),
    };

    pojoEngineFieldUpdateEvents[key] = clone(engineFieldUpdateEvents[key]);
    pojoEngineFieldStoreEvents[key] = clone(engineFieldStoreEvents[key]);
  });
});

export const initEvents = async () => {
  for (const path of internalEventHandlerPaths) {
    const handlerCode = fs.readFileSync(path, "utf8");
    const handler = vm.run(handlerCode) as EventHandler;
    if (!handler.id) {
      throw new Error(`Event handler ${path} is missing id`);
    }
    handler.isConditional =
      handler.fields && !!handler.fields.find((f) => f.type === "events");
    eventHandlers[handler.id] = handler;
    pojoEventHandlers[handler.id] = clone(handler);
  }
};

export const eventLookup = {
  eventsLookup: pojoEventHandlers,
  engineFieldUpdateEventsLookup: pojoEngineFieldUpdateEvents,
  engineFieldStoreEventsLookup: pojoEngineFieldStoreEvents,
} as const;

export default eventHandlers;

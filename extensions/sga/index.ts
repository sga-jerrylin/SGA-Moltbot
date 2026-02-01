import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

import { sgaPlugin } from "./src/channel.js";

const plugin = {
  id: "sga",
  name: "SGA",
  description: "SGA channel plugin for WeCom/Feishu/DingTalk integration",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.registerChannel({ plugin: sgaPlugin });
  },
};

export default plugin;

import { register } from "node:module";

register(new URL("./fake-keyring-loader.mjs", import.meta.url).href);

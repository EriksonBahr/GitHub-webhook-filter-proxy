import { gh_webhook } from "./actual_return";
import { templatePathParser } from "./templatePathParser";

const output = templatePathParser(
  gh_webhook,
  "this is my text |$.action| - |$.pull_request.head.user.login|",
);

console.log(output);

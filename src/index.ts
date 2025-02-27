import jp from "jsonpath";
import {
  getGitHubEventName,
  getRawGitHubEventName,
  GitHubEventName,
  verifyGitHubWebhookSignature,
} from "./github";
import {
  MSTeamsWebhook,
  PotentialAction,
  Section,
  Target,
} from "./model/msteams";
import { templatePathParser } from "./templatePathParser";

// A HTTP status code this worker may include in its responses.
enum ResponseCode {
  ACCEPTED = 202,
  BAD_REQUEST = 400,
  FORBIDDEN = 403,
  UNSUPPORTED_MEDIA_TYPE = 415,
  INTERNAL_SERVER_ERROR = 500,
}

// A settings key whose value contains the JSONPath expression used
// for matching the payloads of some event type.
type EventMatchJsonpathKey = `${GitHubEventName}_EVENT_MATCH_JSONPATH`;

// A settings key whose value indicates whether to relay or drop
// this event to the target (proxied) URL.
type EventMatchActionKey = `${GitHubEventName}_EVENT_MATCH_ACTION`;

// An action this proxy can do with an event: relay it to a target
// URL or drop it.
type EventAction = "relay" | "drop";

// Represents all the possible settings for this proxy. Editing
// this type usually requires editing user documentation too.
type Settings = {
  [key in `${EventMatchJsonpathKey}`]?: string;
} & { [key in `${EventMatchActionKey}`]?: EventAction } & {
  SECRET_TOKEN: string;
  TARGET_URL: string;
  UNMATCHED_EVENT_ACTION?: EventAction;
  ADAPT_TO_MS_TEAMS_WEBHOOK: boolean;
  MS_TEAMS_SUMMARY_TEMPLATE_PATH: string;
  MS_TEAMS_TITLE_TEMPLATE_PATH: string;
  MS_TEAMS_SUBTITLE_TEMPLATE_PATH: string;
  MS_TEAMS_ACTION_NAME: string;
  MS_TEAMS_ACTION_TEMPLATE_URL: string;
};

export default {
  async fetch(request: Request, env: Settings): Promise<Response> {
    // First, do some quick sanity checks for the request
    if (request.method !== "POST") {
      return new Response("Unexpected HTTP method", {
        status: ResponseCode.BAD_REQUEST,
        headers: { Allow: "POST" },
      });
    }

    if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
      return new Response(
        "Missing or bad content type header for a JSON payload",
        { status: ResponseCode.UNSUPPORTED_MEDIA_TYPE },
      );
    }

    const eventName = getGitHubEventName(request.headers);
    if (!eventName) {
      return new Response(
        `Missing, invalid or unrecognized event name: ${getRawGitHubEventName(
          request.headers,
        )}`,
        {
          status: ResponseCode.BAD_REQUEST,
        },
      );
    }

    // Try to get plain text from the body. This can fail if the body is binary data
    // that cannot be decoded as UTF-8
    let requestBody;
    try {
      requestBody = await request.text();
    } catch (e) {
      return new Response("The request body is not valid text", {
        status: ResponseCode.BAD_REQUEST,
      });
    }

    // Reject unsigned or badly signed requests, so our proxy will only accept
    // requests coming from GitHub or some other party that knows a shared secret
    try {
      const isWebhookSignatureValid = await verifyGitHubWebhookSignature(
        env.SECRET_TOKEN,
        request.headers,
        requestBody,
      );

      if (!isWebhookSignatureValid) {
        return new Response("Missing or invalid GitHub webhook signature", {
          status: ResponseCode.FORBIDDEN,
        });
      }
    } catch (e) {
      return new Response(`Crypto error (bad worker configuration?): ${e}`, {
        status: ResponseCode.INTERNAL_SERVER_ERROR,
      });
    }

    // Validate the JSON in the request body and parse it to an object
    let eventBody;
    try {
      eventBody = JSON.parse(requestBody);

      console.debug(`Received ${eventName} event`);
    } catch (e) {
      return new Response(`JSON parse error: ${e}`, {
        status: ResponseCode.BAD_REQUEST,
      });
    }

    // Check whether the event body matches some configured JSONPath expression
    let eventBodyMatches;
    let eventMatches;
    const matchJsonpath = env[`${eventName}_EVENT_MATCH_JSONPATH`];
    if (matchJsonpath !== undefined) {
      eventBodyMatches = jp.query([eventBody], matchJsonpath, 1).length > 0;
      eventMatches = true;
    } else {
      eventBodyMatches = false;
      eventMatches = false;
    }

    let eventAction: EventAction;
    if (eventMatches) {
      // We have some JSONPath expression for this event that we checked. It either could match or not

      if (eventBodyMatches) {
        // The body matched the configured JSONPath. Run the configured action for a match,
        // defaulting to "drop"

        eventAction = env[`${eventName}_EVENT_MATCH_ACTION`] ?? "drop";

        console.debug(
          `Event ${eventName} matched the configured JSONPath expression. Filtering action: ${eventAction}`,
        );
      } else {
        // The body did not match the configured JSONPath. Invert the configured action for
        // a match, defaulting to "relay"

        const matchAction = env[`${eventName}_EVENT_MATCH_ACTION`];
        eventAction = matchAction === "relay" ? "drop" : "relay";

        console.debug(
          `Event ${eventName} did not match the configured JSONPath expression. Filtering action: ${eventAction}`,
        );
      }
    } else {
      // We do not have a JSONPath expression for this event. Fallback to the default action, or "drop"
      // if it is not set

      eventAction = env.UNMATCHED_EVENT_ACTION ?? "drop";

      console.debug(
        `Event ${eventName} did not match any configured JSONPath expression. Filtering action: ${eventAction}`,
      );
    }

    if (eventAction === "relay") {
      const msTeamsPayload = {
        "@type": "MessageCard",
        themeColor: "0076D7",
        summary: templatePathParser(
          eventBody,
          env.MS_TEAMS_SUMMARY_TEMPLATE_PATH,
        ),
        sections: [
          {
            activityTitle: templatePathParser(
              eventBody,
              env.MS_TEAMS_TITLE_TEMPLATE_PATH,
            ),
            activitySubtitle: templatePathParser(
              eventBody,
              env.MS_TEAMS_SUBTITLE_TEMPLATE_PATH,
            ),
          },
        ] as Section[],
        potentialAction: [
          {
            "@type": "OpenUri",
            name: env.MS_TEAMS_ACTION_NAME,
            targets: [
              {
                os: "default",
                uri: templatePathParser(
                  eventBody,
                  env.MS_TEAMS_ACTION_TEMPLATE_URL,
                ),
              },
            ] as Target[],
          },
        ] as PotentialAction[],
      } as MSTeamsWebhook;
      // Relay the request we've received as-is, barring some additional headers added by Cloudflare
      try {
        return await fetch(
          new Request(env.TARGET_URL, {
            method: request.method,
            headers: request.headers,
            body: JSON.stringify(msTeamsPayload),
          }),
        );
      } catch (e) {
        return new Response(`Could not deliver event to target URL: ${e}`, {
          status: ResponseCode.INTERNAL_SERVER_ERROR,
        });
      }
    } else {
      // Let GitHub know that the event was delivered, but we've filtered it
      return new Response("Dropped by proxy", {
        status: ResponseCode.ACCEPTED,
      });
    }
  },
};

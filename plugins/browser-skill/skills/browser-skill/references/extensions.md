# Extension installation and management

Install on the intended real Chrome profile: owner opens `chrome://extensions`,
enables Developer mode, selects Load unpacked, and chooses
`~/.local/share/browserskill-fork/chrome-extension`. Reload an existing unpacked
installation instead of duplicating it. Open the popup, enable Local connection
with the daemon's reported port, then grant Bookmark access / Extension management
only as needed. The official store build lacks the fork features.

Store extensions: owner opens `https://chromewebstore.google.com/detail/<id>`,
clicks Add to Chrome then Add extension. BrowserSkill rejects restricted store /
internal pages; do not bypass this using evaluate/CDP. Headless CfT cannot install
from the store. External JSON on macOS still needs owner confirmation; enterprise
policy changes require a separately managed deployment, not task automation.

Unattended testing: use a dedicated Chrome for Testing / Chromium profile with
`--user-data-dir=<new-temp-dir> --load-extension=<absolute-extension-dir>`.
This is a separate browser without the owner's logins. Never pass the owner's
profile path or change their policies. Optional permissions still need owner
consent; integration tests grant them only in a disposable copy at installation.

CWS API can upload/publish updates after the owner registers/pays, prepares the
listing, selects Unlisted and completes first visibility publication, then supplies
scoped OAuth/service-account access via the credential facility. Review is not
instant or bypassable; no accounts or credentials are created by this tool.

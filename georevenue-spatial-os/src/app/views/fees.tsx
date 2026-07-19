"use client";

/**
 * Top-level Fees page. Promoted from Settings → Fee schedule so it gets its
 * own nav slot for admins and finance managers. The underlying CRUD widget
 * still lives in views/settings.tsx as `SettingsFees`; this is a thin wrapper.
 */

import { SettingsFees } from "./settings";

function FeesPage() {
  return <SettingsFees />;
}

export { FeesPage };

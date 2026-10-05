import { useState } from "react";
import AccountActions from "@components/profile/AccountActions";
import AppearanceCard from "@components/profile/AppearanceCard";
import CoachSettingsCard from "@components/profile/CoachSettingsCard";
import JournalSettingsCard from "@components/profile/JournalSettingsCard";
import ChangePasswordDialog from "@components/profile/ChangePasswordDialog";
import DeleteAccountDialog from "@components/profile/DeleteAccountDialog";
import MyPublishedPlans from "@components/profile/MyPublishedPlans";
import ProfileAvatar from "@components/profile/ProfileAvatar";
import ProfileInfoCard from "@components/profile/ProfileInfoCard";

/**
 * Two columns on desktop: who you are on the left, what you can change on the
 * right. The page was a single 480px column at every width, so on a wide
 * screen it was a phone layout stranded in the middle of the viewport.
 *
 * The identity block is small, fixed and never scrolls out of relevance, which
 * is exactly what a sticky column is for; everything else is a stack of things
 * you act on.
 */
export default function ProfilePage() {
  const [changingPassword, setChangingPassword] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  return (
    <div className="min-h-screen bg-canvas pb-28 md:pb-12">
      {/* The desktop header is switched off for this route, so the page names
          itself. On mobile the header still supplies the title. */}
      <h1 className="page-gutter max-w-120 md:max-w-5xl mx-auto display-4 hidden md:block pt-10">
        Profile
      </h1>

      <div
        className={[
          "page-gutter pt-6 md:pt-6",
          "max-w-120 md:max-w-5xl mx-auto",
          "flex flex-col gap-6",
          "md:grid md:grid-cols-[280px_1fr] md:items-start md:gap-8",
        ].join(" ")}
      >
        <div className="md:sticky md:top-10">
          <ProfileAvatar />
        </div>

        <div className="flex flex-col gap-6 min-w-0">
          <ProfileInfoCard />
          <MyPublishedPlans />
          <AppearanceCard />
          <JournalSettingsCard />
          <CoachSettingsCard />
          <AccountActions
            onChangePassword={() => setChangingPassword(true)}
            onDeleteAccount={() => setDeletingAccount(true)}
          />
        </div>
      </div>

      <ChangePasswordDialog
        open={changingPassword}
        onOpenChange={setChangingPassword}
      />
      <DeleteAccountDialog
        open={deletingAccount}
        onOpenChange={setDeletingAccount}
      />
    </div>
  );
}

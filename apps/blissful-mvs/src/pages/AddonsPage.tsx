import { Button, Input } from '@heroui/react';
import { useAppContext } from '../context/AppContext';
import { getAddonDisplayName } from '../lib/stremioApi';

export default function AddonsPage() {
  const {
    addons,
    addonsQuery,
    setAddonsQuery,
    addonsLoading,
    openAddAddon,
    uninstallAddon,
  } = useAppContext();

  const filtered = addonsQuery.trim()
    ? addons.filter((addon) => {
      const name = getAddonDisplayName(addon);
      const desc = addon.manifest?.description ?? '';
      const q = addonsQuery.trim().toLowerCase();
      return name.toLowerCase().includes(q) || desc.toLowerCase().includes(q);
    })
    : addons;

  return (
    <div className="mt-4 space-y-6 overflow-x-hidden">
      <div className="solid-surface rounded-[28px] bg-white/6 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-[Fraunces] text-2xl font-semibold">Addons</div>
            <div className="text-sm text-foreground/60">Manage your installed addons.</div>
          </div>
          <Button className="rounded-full bg-white text-black" onPress={openAddAddon}>
            Add addon
          </Button>
        </div>

        <div className="mt-4">
          <Input
            value={addonsQuery}
            onChange={(e) => setAddonsQuery(e.target.value)}
            placeholder="Search addons"
            className="solid-surface w-full bg-white/6 border border-white/10 rounded-full h-11 px-4"
          />
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {filtered.length === 0 ? (
            <div className="text-sm text-foreground/60">No addons found.</div>
          ) : (
            filtered.map((addon) => (
              <div key={addon.transportUrl} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-sm font-semibold break-words">
                  {getAddonDisplayName(addon)}
                </div>
                {addon.manifest?.description ? (
                  <div className="mt-1 text-xs text-foreground/60">{addon.manifest.description}</div>
                ) : null}
                <div className="mt-4 flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="rounded-full bg-white/10"
                    isPending={addonsLoading}
                    onPress={() => uninstallAddon(addon.transportUrl)}
                  >
                    Uninstall
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

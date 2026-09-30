import { Download } from 'lucide-react';

import { Button } from '@/components/ui/button';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { LocalStorageDialog } from './local-storage-dialog';

import type { EditorDialogsProps } from './editor-composition-types';
export function EditorDialogs({
  storageOpen,
  setStorageOpen,
  session,
  sessionSnapshot,
  storageButtonRef,
  editorCommands,
  boardMode,
  activeDialog,
  resetPending,
  setResetError,
  actions,
  resetButtonRef,
  resetError,
  projection,
  downloadRecovery,
  canReset,
  confirmReset,
  serverReloadOpen,
  serverReloadPending,
  setServerReloadOpen,
  setServerReloadError,
  serverReloadError,
  confirmServerReload,
  helpButtonRef,
  shortcutModifier,
}: EditorDialogsProps) {
  return (
    <>
      <LocalStorageDialog
        open={storageOpen}
        onOpenChange={setStorageOpen}
        session={session}
        snapshot={sessionSnapshot}
        returnFocusRef={storageButtonRef}
      />

      <Dialog
        open={editorCommands.deleteConfirmationOpen}
        onOpenChange={(open) => {
          if (!open) editorCommands.cancelDelete();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete selected objects?</DialogTitle>
            <DialogDescription>
              This selection contains more than 10 objects. The objects and internal connections
              will be deleted together. Undo does not apply to deletion.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={editorCommands.cancelDelete}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={editorCommands.confirmDelete}>
              Delete objects
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!boardMode && activeDialog === 'reset'}
        onOpenChange={(open) => {
          if (!open && !resetPending) {
            setResetError(null);
            actions.closeDialog();
          }
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            resetButtonRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Reset the local demo?</DialogTitle>
            <DialogDescription>
              This replaces only this device&apos;s local demo board with a fresh copy. Download a
              recovery file first if you want to keep the current graph.
            </DialogDescription>
          </DialogHeader>
          {resetError !== null && (
            <p className="text-sm text-destructive" role="alert">
              {resetError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={resetPending || projection === null}
              onClick={downloadRecovery}
            >
              <Download /> Download recovery
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={resetPending}
              onClick={actions.closeDialog}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={resetPending || !canReset}
              onClick={() => void confirmReset()}
            >
              {resetPending ? 'Resetting…' : 'Reset local demo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={boardMode && serverReloadOpen}
        onOpenChange={(open) => {
          if (!serverReloadPending) {
            setServerReloadOpen(open);
            setServerReloadError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reload the server version?</DialogTitle>
            <DialogDescription>
              This deletes this board&apos;s local copy and pending changes for this account on this
              device. Changes without a server receipt will be lost. Download recovery first if you
              want to keep them. Other accounts and boards are not cleared.
            </DialogDescription>
          </DialogHeader>
          {serverReloadError !== null && (
            <p className="text-sm text-destructive" role="alert">
              {serverReloadError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={serverReloadPending || projection === null}
              onClick={downloadRecovery}
            >
              <Download /> Download recovery
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={serverReloadPending}
              onClick={() => setServerReloadOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={serverReloadPending || !session?.canReloadServerVersion()}
              onClick={() => void confirmServerReload()}
            >
              {serverReloadPending ? 'Reloading…' : 'Delete local copy and reload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={activeDialog === 'help'}
        onOpenChange={(open) => (open ? actions.openDialog('help') : actions.closeDialog())}
      >
        <DialogContent
          className="sm:max-w-xl"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            helpButtonRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Keyboard help</DialogTitle>
            <DialogDescription>
              Editing shortcuts become available after the local board finishes loading.
            </DialogDescription>
          </DialogHeader>
          <dl className="grid gap-2">
            <div className="flex items-center justify-between gap-3 max-sm:flex-col max-sm:items-start border-b py-2">
              <dt>Pan canvas</dt>
              <dd className="rounded border bg-muted px-2 py-1 font-mono text-xs tabular-nums">
                Space + drag
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 max-sm:flex-col max-sm:items-start border-b py-2">
              <dt>Zoom</dt>
              <dd className="rounded border bg-muted px-2 py-1 font-mono text-xs tabular-nums">
                Ctrl + scroll
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 max-sm:flex-col max-sm:items-start py-2">
              <dt>Clear selection</dt>
              <dd className="rounded border bg-muted px-2 py-1 font-mono text-xs tabular-nums">
                Escape
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 max-sm:flex-col max-sm:items-start border-t py-2">
              <dt>Delete selection</dt>
              <dd className="rounded border bg-muted px-2 py-1 font-mono text-xs tabular-nums">
                Delete
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 max-sm:flex-col max-sm:items-start border-t py-2">
              <dt>Duplicate</dt>
              <dd className="rounded border bg-muted px-2 py-1 font-mono text-xs tabular-nums">
                {shortcutModifier}+D
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 max-sm:flex-col max-sm:items-start border-t py-2">
              <dt>Copy / paste selection</dt>
              <dd className="rounded border bg-muted px-2 py-1 font-mono text-xs tabular-nums">
                {shortcutModifier}+C / {shortcutModifier}+V
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 max-sm:flex-col max-sm:items-start border-t py-2">
              <dt>Undo / redo edits</dt>
              <dd className="rounded border bg-muted px-2 py-1 font-mono text-xs tabular-nums">
                {shortcutModifier}+Z / {shortcutModifier}+Shift+Z
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 max-sm:flex-col max-sm:items-start border-t py-2">
              <dt>Fit content / zoom</dt>
              <dd className="rounded border bg-muted px-2 py-1 font-mono text-xs tabular-nums">
                F / + / -
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 max-sm:flex-col max-sm:items-start border-t py-2">
              <dt>Open this dialog</dt>
              <dd className="rounded border bg-muted px-2 py-1 font-mono text-xs tabular-nums">
                ?
              </dd>
            </div>
          </dl>
          <p className="text-xs leading-5 text-muted-foreground">
            Structural commands are excluded from Undo. Deleted objects can be restored until
            reload.
          </p>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </>
  );
}

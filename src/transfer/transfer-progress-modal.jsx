import { Modal } from "../ui/modal.jsx";
import { LinearProgress } from "../ui/progress-bar.jsx";
import { transferDialogFor } from "./transfer.js";

export function TransferProgressModal({ progress, onClose }) {
    const dialog = transferDialogFor(progress);
    if (!dialog)
        return null;
    const running = dialog.status === "running";
    const indeterminate = running && dialog.indeterminate;
    return (
        <Modal icon={dialog.icon} title={dialog.title} size="sm" onClose={onClose} closable={!running}>
            <div className="transfer-progress-dialog">
                {indeterminate ? null : <div className="transfer-progress-percent">{`${dialog.percent}%`}</div>}
                <div className="transfer-progress-label">{dialog.label}</div>
                <LinearProgress status={dialog.status} label={dialog.label} indeterminate={indeterminate} percent={dialog.percent} />
            </div>
        </Modal>
    );
}

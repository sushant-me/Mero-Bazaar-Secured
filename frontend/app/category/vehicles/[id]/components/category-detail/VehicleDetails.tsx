import { VEHICLE_DETAILS_LABELS} from "../shared/vehicleDetailsMap";
import type { VehicleType } from "../../../../../types/vehicle";

type Props = {
  type: VehicleType | undefined;
  details: Record<string, unknown>;
};

export default function VehicleDetails({ type, details }: Props) {
  const labels = type ? VEHICLE_DETAILS_LABELS[type] : undefined;

  if (!labels) return null;

  const rows = Object.entries(labels).map(([key, label]): [string, string] => {
    const raw = details?.[key];
    const value = raw !== undefined && raw !== null ? String(raw) : "-";
    return [label, value];
  });

  return (
    <div className="ld-details-card">
      <h2 className="ld-section-title">Vehicle Details</h2>

      <div className="ld-details-grid">
        <div className="ld-details-col">
          {rows.map(([label, val]) => (
            <div key={label} className="ld-detail-row">
              <span className="ld-detail-label">{label}</span>
              <span className="ld-detail-val">{String(val)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
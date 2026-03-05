interface Props {
  onClose: () => void;
  onSelectEntry?: (id: string) => void;
}

export function PasswordAudit({ onClose }: Props) {
  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Security Audit</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 18 }}>&times;</button>
      </div>
      <p style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>Password audit coming soon.</p>
    </div>
  );
}

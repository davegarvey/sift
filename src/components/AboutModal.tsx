export function AboutModal() {
  return (
    <div class="modal modal-center" onClick={(e) => e.stopPropagation()}>
      <div class="modal-header">About</div>
      <div class="modal-body" style={{ 'padding-bottom': '20px' }}>
        <p style={{ margin: '0 0 12px', 'line-height': '1.6' }}>
          Sift is a simple, browser-first RSS reader.
        </p>
        <p style={{ margin: 0, 'line-height': '1.6' }}>
          made by <a href="https://github.com/davegarvey" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', 'text-decoration': 'none' }}>dave</a>
        </p>
      </div>
    </div>
  );
}

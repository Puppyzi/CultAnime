export function mediaFormatLabel(format) {
  const value = String(format || '').trim().toUpperCase();

  switch (value) {
    case 'TV':
      return 'TV';
    case 'TV_SHORT':
      return 'TV Short';
    case 'MOVIE':
      return 'Movie';
    case 'OVA':
      return 'OVA';
    case 'ONA':
      return 'ONA';
    case 'SPECIAL':
      return 'Special';
    default:
      return value ? value.replace(/_/g, ' ') : '';
  }
}

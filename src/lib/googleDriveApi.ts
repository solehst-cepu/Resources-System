export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  iconLink?: string;
  parents?: string[];
  trashed?: boolean;
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
}

export interface DriveListResult {
  files: DriveFileItem[];
  nextPageToken?: string;
}

export class DriveAuthExpiredError extends Error {
  constructor(message = 'Sesi Google Drive telah berakhir. Silakan Sign in with Google kembali.') {
    super(message);
    this.name = 'DriveAuthExpiredError';
  }
}

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

async function handleDriveResponse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    throw new DriveAuthExpiredError();
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const msg =
      (errBody as { error?: { message?: string } })?.error?.message ||
      `Permintaan Google Drive gagal (HTTP ${res.status})`;
    throw new Error(msg);
  }
  if (res.status === 204) {
    return {} as T;
  }
  return (await res.json()) as T;
}

export async function listDriveFiles(
  accessToken: string,
  options?: {
    search?: string;
    mimeFilter?: 'all' | 'folders' | 'pdf' | 'docs' | 'sheets' | 'images';
    parentId?: string;
    pageToken?: string;
    pageSize?: number;
  }
): Promise<DriveListResult> {
  const clauses: string[] = ['trashed = false'];

  if (options?.parentId) {
    const safeParent = options.parentId.replace(/'/g, "\\'");
    clauses.push(`'${safeParent}' in parents`);
  }

  if (options?.search?.trim()) {
    const safeQuery = options.search.trim().replace(/'/g, "\\'");
    clauses.push(`name contains '${safeQuery}'`);
  }

  if (options?.mimeFilter === 'folders') {
    clauses.push("mimeType = 'application/vnd.google-apps.folder'");
  } else if (options?.mimeFilter === 'pdf') {
    clauses.push("mimeType = 'application/pdf'");
  } else if (options?.mimeFilter === 'docs') {
    clauses.push(
      "(mimeType = 'application/vnd.google-apps.document' or mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' or mimeType = 'application/msword')"
    );
  } else if (options?.mimeFilter === 'sheets') {
    clauses.push(
      "(mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')"
    );
  } else if (options?.mimeFilter === 'images') {
    clauses.push("mimeType contains 'image/'");
  }

  const params = new URLSearchParams({
    q: clauses.join(' and '),
    pageSize: String(options?.pageSize || 30),
    orderBy: 'folder,modifiedTime desc',
    fields:
      'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,iconLink,parents,trashed,owners(displayName,emailAddress))',
  });

  if (options?.pageToken) {
    params.set('pageToken', options.pageToken);
  }

  const res = await fetch(`${DRIVE_API_BASE}/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return handleDriveResponse<DriveListResult>(res);
}

export async function createDriveFolder(
  accessToken: string,
  name: string,
  parentId?: string
): Promise<DriveFileItem> {
  const metadata: Record<string, unknown> = {
    name: name.trim(),
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) {
    metadata.parents = [parentId];
  }

  const res = await fetch(`${DRIVE_API_BASE}/files?fields=id,name,mimeType,modifiedTime,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metadata),
  });
  return handleDriveResponse<DriveFileItem>(res);
}

export async function uploadFileToDrive(
  accessToken: string,
  fileBlob: Blob,
  fileName: string,
  mimeType: string,
  parentId?: string
): Promise<DriveFileItem> {
  const metadata: Record<string, unknown> = {
    name: fileName,
  };
  if (parentId) {
    metadata.parents = [parentId];
  }

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', fileBlob, fileName);

  const res = await fetch(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,webViewLink`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    }
  );
  return handleDriveResponse<DriveFileItem>(res);
}

export async function downloadDriveFileBlob(
  accessToken: string,
  file: DriveFileItem
): Promise<{ blob: Blob; fileName: string; mimeType: string }> {
  const isGoogleWorkspaceDoc = file.mimeType.startsWith('application/vnd.google-apps.');

  let url = `${DRIVE_API_BASE}/files/${encodeURIComponent(file.id)}?alt=media`;
  let outName = file.name;
  let outMime = file.mimeType || 'application/octet-stream';

  if (isGoogleWorkspaceDoc) {
    // Export Google Docs / Sheets / Slides cleanly to PDF for printing & photocopying
    url = `${DRIVE_API_BASE}/files/${encodeURIComponent(file.id)}/export?mimeType=application/pdf`;
    outMime = 'application/pdf';
    if (!outName.toLowerCase().endsWith('.pdf')) {
      outName = `${outName}.pdf`;
    }
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 401) {
    throw new DriveAuthExpiredError();
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const msg =
      (errBody as { error?: { message?: string } })?.error?.message ||
      `Gagal mengunduh file dari Google Drive (HTTP ${res.status})`;
    throw new Error(msg);
  }

  const blob = await res.blob();
  return { blob, fileName: outName, mimeType: outMime };
}

export async function renameDriveFile(
  accessToken: string,
  fileId: string,
  newName: string
): Promise<DriveFileItem> {
  const res = await fetch(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime,webViewLink`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: newName.trim() }),
    }
  );
  return handleDriveResponse<DriveFileItem>(res);
}

export async function deleteDriveFile(accessToken: string, fileId: string): Promise<void> {
  const res = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  await handleDriveResponse<Record<string, never>>(res);
}

export function isFolder(file: DriveFileItem): boolean {
  return file.mimeType === 'application/vnd.google-apps.folder';
}

export function getFriendlyDriveMimeLabel(mimeType: string): string {
  if (mimeType === 'application/vnd.google-apps.folder') return 'Folder';
  if (mimeType === 'application/vnd.google-apps.document') return 'Google Docs';
  if (mimeType === 'application/vnd.google-apps.spreadsheet') return 'Google Sheets';
  if (mimeType === 'application/vnd.google-apps.presentation') return 'Google Slides';
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType.startsWith('image/')) return 'Gambar';
  if (mimeType.includes('wordprocessingml') || mimeType.includes('msword')) return 'Word';
  if (mimeType.includes('spreadsheetml') || mimeType.includes('excel')) return 'Excel';
  return 'File';
}

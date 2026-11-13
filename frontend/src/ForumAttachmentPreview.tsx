import { useEffect, useState } from "react";
import { API_URL, api, previewForumAttachment } from "./api";

type Attachment = Record<string, unknown>;

function field(file: Attachment, names: string[]): string {
  for (const name of names) {
    const value = file[name];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function fileId(file: Attachment): number {
  return Number(file.id ?? file.attachment_id ?? file.file_id ?? 0);
}

function fileName(file: Attachment): string {
  return field(file, [
    "original_filename",
    "original_name",
    "filename",
    "file_name",
    "name",
    "stored_filename"
  ]) || `Файл ${fileId(file)}`;
}

function fileKind(file: Attachment): "image" | "video" | "audio" | "document" {
  const mime = field(file, [
    "content_type",
    "mime_type",
    "media_type",
    "file_type"
  ]).toLowerCase();

  const extension = fileName(file).split(".").pop()?.toLowerCase() || "";

  if (mime.startsWith("image/") ||
      ["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(extension)) {
    return "image";
  }

  if (mime.startsWith("video/") ||
      ["mp4", "webm", "mov", "m4v", "ogv"].includes(extension)) {
    return "video";
  }

  if (mime.startsWith("audio/") ||
      ["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(extension)) {
    return "audio";
  }

  return "document";
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("comind_access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function downloadFile(file: Attachment) {
  const response = await fetch(
    `${API_URL.replace(/\/+$/, "")}/api/forum/attachments/${fileId(file)}/download`,
    { headers: authHeaders() }
  );

  if (!response.ok) throw new Error("Не удалось скачать вложение");

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName(file);
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function ForumAttachmentPreview({
  attachments
}: {
  attachments?: Attachment[] | null;
}) {
  const files = (attachments || []).filter(file => fileId(file) > 0);
  const signature = JSON.stringify(files);

  const [media, setMedia] = useState<Record<number, string>>({});

  useEffect(() => {
    let active = true;
    const urls: string[] = [];

    async function loadMedia() {
      const currentFiles = JSON.parse(signature) as Attachment[];
      const loaded: Record<number, string> = {};

      for (const file of currentFiles) {
        const kind = fileKind(file);

        if (kind !== "image" && kind !== "audio") continue;

        try {
          const response = await fetch(
            `${API_URL.replace(/\/+$/, "")}/api/forum/attachments/${fileId(file)}/download`,
            { headers: authHeaders() }
          );

          if (!response.ok) continue;

          const blob = await response.blob();
          const url = URL.createObjectURL(blob);

          if (!active) {
            URL.revokeObjectURL(url);
            continue;
          }

          urls.push(url);
          loaded[fileId(file)] = url;
        } catch (error) {
          console.error("Ошибка загрузки медиа VIAMUCUS:", error);
        }
      }

      if (active) setMedia(loaded);
    }

    setMedia({});
    void loadMedia();

    return () => {
      active = false;
      urls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [signature]);

  if (!files.length) return null;

  return (
    <div className="viamucus-attachment-gallery">
      {files.map(file => {
        const id = fileId(file);
        const name = fileName(file);
        const kind = fileKind(file);

        return (
          <div className="viamucus-attachment-item" key={id}>
            {kind === "image" && (
              media[id] ? (
                <img
                  src={media[id]}
                  alt={name}
                  className="viamucus-gallery-image"
                  loading="lazy"
                />
              ) : (
                <span className="viamucus-media-loading">
                  Загрузка изображения...
                </span>
              )
            )}

            {kind === "audio" && (
              media[id] ? (
                <audio controls preload="metadata" src={media[id]} />
              ) : (
                <span className="viamucus-media-loading">
                  Загрузка аудио...
                </span>
              )
            )}

            {(kind === "video" || kind === "document") && (
              <>
                <span className="viamucus-attachment-name">{name}</span>
                <div className="viamucus-attachment-actions">
                  <button
                    type="button"
                    onClick={() => {
                      void previewForumAttachment(id, name).catch(error => {
                        console.error(error);
                        alert("Не удалось открыть файл.");
                      });
                    }}
                  >
                    {kind === "video" ? "▶ Просмотр видео" : "Просмотр"}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      void downloadFile(file).catch(error => {
                        console.error(error);
                        alert("Не удалось скачать файл.");
                      });
                    }}
                  >
                    Скачать
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function TopicAttachmentPreview({ topicId }: { topicId: number }) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  useEffect(() => {
    let active = true;

    api.getForumTopic(topicId)
      .then(topic => {
        const data = topic as unknown as {
          attachments?: Attachment[];
        };

        if (active) setAttachments(data.attachments || []);
      })
      .catch(error => console.error("Вложения темы:", error));

    return () => {
      active = false;
    };
  }, [topicId]);

  return <ForumAttachmentPreview attachments={attachments} />;
}

export function HomeForumAttachmentFeed() {
  const [ids, setIds] = useState<number[]>([]);

  useEffect(() => {
    let active = true;

    fetch(`${API_URL.replace(/\/+$/, "")}/api/forum/topics`, {
      headers: authHeaders()
    })
      .then(response => {
        if (!response.ok) throw new Error("Не удалось получить темы");
        return response.json();
      })
      .then(result => {
        const items = Array.isArray(result.items) ? result.items : [];
        if (active) {
          setIds(items.slice(0, 8).map((item: { id: number }) => item.id));
        }
      })
      .catch(error => console.error("Вложения главной:", error));

    return () => {
      active = false;
    };
  }, []);

  if (!ids.length) return null;

  return (
    <section className="viamucus-home-attachments">
      {ids.map(id => (
        <TopicAttachmentPreview key={id} topicId={id} />
      ))}
    </section>
  );
}
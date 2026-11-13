import { useEffect, useState } from "react";
import { API_URL, api, previewForumAttachment } from "./api";

type Attachment = {
  id: number;
  original_filename?: string;
  original_name?: string;
  filename?: string;
  name?: string;
  content_type?: string;
  mime_type?: string;
};

function attachmentName(file: Attachment): string {
  return file.original_filename ||
    file.original_name ||
    file.filename ||
    file.name ||
    `Файл ${file.id}`;
}

function extension(file: Attachment): string {
  return attachmentName(file).split(".").pop()?.toLowerCase() || "";
}

function kind(file: Attachment): "image" | "video" | "audio" | "file" {
  const mime = (file.content_type || file.mime_type || "").toLowerCase();
  const ext = extension(file);

  if (mime.startsWith("image/") ||
      ["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "image";

  if (mime.startsWith("video/") ||
      ["mp4", "webm", "mov", "m4v", "ogv"].includes(ext)) return "video";

  if (mime.startsWith("audio/") ||
      ["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(ext)) return "audio";

  return "file";
}

async function downloadAttachment(file: Attachment) {
  const token = localStorage.getItem("comind_access_token");
  const base = API_URL.replace(/\/+$/, "");

  const response = await fetch(
    `${base}/api/forum/attachments/${file.id}/download`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  );

  if (!response.ok) throw new Error("Не удалось скачать файл");

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = attachmentName(file);
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
  const files = Array.isArray(attachments)
    ? attachments.filter(file => file && Number(file.id) > 0)
    : [];

  const signature = JSON.stringify(files);
  const [imageUrls, setImageUrls] = useState<Record<number, string>>({});
  const [audioUrls, setAudioUrls] = useState<Record<number, string>>({});

  useEffect(() => {
    let active = true;
    const created: string[] = [];

    const loadMedia = async () => {
      const currentFiles = JSON.parse(signature) as Attachment[];
      const mediaFiles = currentFiles.filter(file =>
        kind(file) === "image" || kind(file) === "audio"
      );

      const token = localStorage.getItem("comind_access_token");
      const base = API_URL.replace(/\/+$/, "");

      for (const file of mediaFiles) {
        try {
          const response = await fetch(
            `${base}/api/forum/attachments/${file.id}/download`,
            { headers: token ? { Authorization: `Bearer ${token}` } : {} }
          );

          if (!response.ok) continue;

          const blob = await response.blob();
          const url = URL.createObjectURL(blob);

          if (!active) {
            URL.revokeObjectURL(url);
            continue;
          }

          created.push(url);

          if (kind(file) === "image") {
            setImageUrls(previous => ({ ...previous, [file.id]: url }));
          } else {
            setAudioUrls(previous => ({ ...previous, [file.id]: url }));
          }
        } catch (error) {
          console.error("VIAMUCUS attachment:", error);
        }
      }
    };

    void loadMedia();

    return () => {
      active = false;
      created.forEach(url => URL.revokeObjectURL(url));
    };
  }, [signature]);

  if (!files.length) return null;

  return (
    <div className="viamucus-attachment-gallery">
      {files.map(file => {
        const name = attachmentName(file);
        const type = kind(file);

        if (type === "image") {
          return (
            <div className="viamucus-attachment-item" key={file.id}>
              {imageUrls[file.id] ? (
                <img
                  className="viamucus-gallery-image"
                  src={imageUrls[file.id]}
                  alt={name}
                  loading="lazy"
                />
              ) : (
                <span className="viamucus-media-loading">Загрузка изображения...</span>
              )}
            </div>
          );
        }

        if (type === "audio") {
          return (
            <div className="viamucus-attachment-item" key={file.id}>
              <span>{name}</span>
              {audioUrls[file.id] ? (
                <audio controls preload="metadata" src={audioUrls[file.id]} />
              ) : (
                <span className="viamucus-media-loading">Загрузка аудио...</span>
              )}
            </div>
          );
        }

        return (
          <div className="viamucus-attachment-item" key={file.id}>
            <span className="viamucus-attachment-name">{name}</span>

            <div className="viamucus-attachment-actions">
              <button
                type="button"
                onClick={() => {
                  void previewForumAttachment(file.id, name).catch(error => {
                    console.error(error);
                    alert("Не удалось открыть вложение.");
                  });
                }}
              >
                {type === "video" ? "▶ Просмотр видео" : "Просмотр"}
              </button>

              <button
                type="button"
                onClick={() => {
                  void downloadAttachment(file).catch(error => {
                    console.error(error);
                    alert("Не удалось скачать файл.");
                  });
                }}
              >
                Скачать
              </button>
            </div>
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
        const data = topic as unknown as { attachments?: Attachment[] };
        if (active) setAttachments(data.attachments || []);
      })
      .catch(error => console.warn("VIAMUCUS topic attachments:", error));

    return () => {
      active = false;
    };
  }, [topicId]);

  return <ForumAttachmentPreview attachments={attachments} />;
}

export function HomeForumAttachmentFeed() {
  const [topicIds, setTopicIds] = useState<number[]>([]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const token = localStorage.getItem("comind_access_token");
      const base = API_URL.replace(/\/+$/, "");

      try {
        const response = await fetch(`${base}/api/forum/topics`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });

        if (!response.ok) return;

        const result = await response.json();
        const ids = (result.items || [])
          .map((item: { id: number }) => Number(item.id))
          .filter((id: number) => Number.isInteger(id) && id > 0)
          .slice(0, 8);

        if (active) setTopicIds(ids);
      } catch (error) {
        console.warn("VIAMUCUS home attachments:", error);
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, []);

  if (!topicIds.length) return null;

  return (
    <section className="viamucus-home-attachments">
      {topicIds.map(id => (
        <TopicAttachmentPreview key={id} topicId={id} />
      ))}
    </section>
  );
}
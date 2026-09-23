alter table public.card_scans
  add column front_preview_path text,
  add column back_preview_path text;

comment on column public.card_scans.front_preview_path is
  'Storage path of a browser-viewable PNG preview of the front scan, generated during recognition from the same normalized image used for OCR/condition analysis. Null until recognition has run at least once, or if preview generation/upload failed. front_image_path (the original, full-fidelity source file — often a scanner-native TIFF that browsers cannot render directly) remains the source of truth for recognition and condition grading and is never replaced.';
comment on column public.card_scans.back_preview_path is
  'Same as front_preview_path, for the back scan.';

import os
import sys

def main():
    dry_run = "--run" not in sys.argv
    dataset_dir = "/Users/gibranariq/Documents/Dibimbing/final_project/data/raw/final_project.yolo"
    splits = ["train", "valid", "test"]
    image_extensions = [".jpg", ".jpeg", ".png", ".PNG", ".JPG", ".JPEG"]

    print("=" * 60)
    print(f"Dataset Renaming Script Running (Dry Run: {dry_run})")
    print("=" * 60)

    for split in splits:
        split_dir = os.path.join(dataset_dir, split)
        images_dir = os.path.join(split_dir, "images")
        labels_dir = os.path.join(split_dir, "labels")

        if not os.path.exists(images_dir) or not os.path.exists(labels_dir):
            print(f"Skipping split '{split}' as it does not contain images or labels directories.")
            continue

        # Get all label files, sorted to ensure deterministic counter assignment
        label_files = sorted([f for f in os.listdir(labels_dir) if f.endswith(".txt")])

        counters = {
            "awake": 1,
            "drowsy": 1,
            "unknown": 1
        }

        rename_pairs = [] # List of tuples: (src_path, dst_path, is_image)

        for label_file in label_files:
            label_path = os.path.join(labels_dir, label_file)
            base_name, _ = os.path.splitext(label_file)

            # Determine class from label content
            class_name = "unknown"
            try:
                with open(label_path, "r") as f:
                    content = f.read().strip()
                if content:
                    first_line = content.split("\n")[0]
                    parts = first_line.split()
                    if parts:
                        class_idx = parts[0]
                        if class_idx == "0":
                            class_name = "awake"
                        elif class_idx == "1":
                            class_name = "drowsy"
                        else:
                            class_name = f"unknown_class_{class_idx}"
            except Exception as e:
                print(f"Warning: Could not read label file {label_path}: {e}")

            # Find matching image file
            matching_img_file = None
            matching_img_ext = None
            for ext in image_extensions:
                img_name = base_name + ext
                img_path = os.path.join(images_dir, img_name)
                if os.path.exists(img_path):
                    matching_img_file = img_name
                    matching_img_ext = ext
                    break

            if not matching_img_file:
                print(f"Warning: No matching image file found for label {label_file}")
                continue

            # Generate new names
            count = counters.get(class_name, 1)
            if class_name not in counters:
                counters[class_name] = 1
            
            new_base_name = f"{split}_{class_name}_{count}"
            counters[class_name] += 1

            new_label_name = new_base_name + ".txt"
            new_img_name = new_base_name + matching_img_ext

            new_label_path = os.path.join(labels_dir, new_label_name)
            new_img_path = os.path.join(images_dir, new_img_name)

            rename_pairs.append((label_path, new_label_path, False))
            rename_pairs.append((os.path.join(images_dir, matching_img_file), new_img_path, True))

        print(f"\nSplit: {split}")
        print(f"Found {len(label_files)} label files.")
        print(f"Renaming summary counts: { {k: v-1 for k, v in counters.items() if v > 1} }")

        # Verify target paths do not exist (to avoid collisions)
        collision_detected = False
        for src, dst, is_img in rename_pairs:
            # If src == dst, that's fine (already renamed or same name), but usually they are different
            if src != dst and os.path.exists(dst):
                print(f"Collision error: Target destination already exists: {dst}")
                collision_detected = True

        if collision_detected:
            print("Aborting renaming for this split due to collisions.")
            continue

        # Print preview of first 5 rename operations
        print("Preview of first 5 renames:")
        preview_count = 0
        for src, dst, is_img in rename_pairs:
            if is_img: # Group by image to show pairing clearly
                # find the corresponding label pair
                label_src = src.replace("images", "labels").replace(os.path.splitext(src)[1], ".txt")
                label_dst = dst.replace("images", "labels").replace(os.path.splitext(dst)[1], ".txt")
                print(f"  {os.path.basename(src)} -> {os.path.basename(dst)}")
                print(f"  {os.path.basename(label_src)} -> {os.path.basename(label_dst)}")
                print("-" * 30)
                preview_count += 1
                if preview_count >= 5:
                    break

        if not dry_run:
            print(f"Executing renaming for {len(rename_pairs)} files...")
            renamed_count = 0
            for src, dst, is_img in rename_pairs:
                try:
                    os.rename(src, dst)
                    renamed_count += 1
                except Exception as e:
                    print(f"Error renaming {src} -> {dst}: {e}")
            print(f"Successfully renamed {renamed_count} files.")
        else:
            print("Dry run mode active. No files were renamed. Use '--run' argument to execute.")

if __name__ == "__main__":
    main()


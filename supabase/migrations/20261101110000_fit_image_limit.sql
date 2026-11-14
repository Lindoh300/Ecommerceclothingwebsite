-- Tagged Instagram photos can be up to 5 MB (MAX_IMAGE_BYTES in instagram.ts), so the bucket must take that size; admin uploads stay at 2 MB in POST /images.
update storage.buckets set file_size_limit = 5242880 where id = 'product-images';

import bpy, sys
a = sys.argv[sys.argv.index('--') + 1:]
for src in a:
    im = bpy.data.images.load(src); s = bpy.context.scene.render.image_settings
    s.file_format = 'WEBP'; s.color_mode = 'RGBA'; s.quality = 78
    im.save_render(src.rsplit('.', 1)[0] + '.webp', scene=bpy.context.scene); print('ok', src)

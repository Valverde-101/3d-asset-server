# Favoritos locales de AndroidBuild

El fork de 3D Asset Server añade `/favoritos` para guardar recursos del buscador y enlaces externos. El código vive en GitHub; la biblioteca personal vive fuera del repositorio.

## Arranque

Control Center inicia el servidor bajo demanda en `127.0.0.1:8791` y le pasa:

- `ASSET_SERVER_FAVORITES_DIR=<AndroidBuild>/State/3d-asset-server/favorites`
- `ASSET_SERVER_REPOSITORIES_DIR=<AndroidBuild>/Repositories`

Las rutas `/local/favorites` solo se registran si la primera variable existe y el servidor escucha en loopback. Las escrituras admiten únicamente JSON desde el mismo origen. La API pública `/v1` y el MCP no exponen la biblioteca.

## Datos y recuperación

`library.json` contiene favoritos, categorías y Papelera. Cada cambio se escribe mediante un archivo temporal y se conserva una copia previa por día de edición en `backups/`, con las siete copias diarias más recientes. **Exportar** descarga un JSON recuperable; **Importar** combina sus elementos sin reemplazar duplicados. Las entradas de Papelera siguen allí hasta que se eliminen expresamente.

No añadas `State/3d-asset-server/favorites` al repositorio. Para restaurar una copia local, detén el servicio, conserva el `library.json` actual aparte y coloca la copia deseada como `library.json`; después vuelve a iniciarlo.

## Uso

La estrella de búsqueda, ficha o colección guarda un recurso como Pendiente. En Favoritos puedes asignar varios proyectos físicos, categorías y etiquetas, añadir enlaces manuales, revisar licencias y filtrar. Un recurso destinado a un proyecto necesita licencia registrada y revisión confirmada antes de pasar a Aprobado. **Comprobar enlace** usa peticiones HEAD bajo demanda; bloqueos de sitios o páginas internas aparecen como «No concluyente».

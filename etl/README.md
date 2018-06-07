# Loading test data into DRIVER

## Boundaries

To load boundaries, retrieve the `regions.zip` and `states.zip` files from the fileshare and load them into Ashlar. Ashlar runs on localhost:7001. For each file, first upload the file, then select `name` as the display field, then hit save. Either refresh the page or navigate somewhere else in between any two uploads.

## Records

A CSV of historical data can be downloaded from the project `/data` folder on fileshare. Good files are `<city or agency>_traffic.csv`.

Once the app has been built, this data can be loaded.

You will first have to obtain an authorization header. Log in to the web application on localhost:7000. Then open the network tab in web developer tools and reload the page. Inspect the request headers from an API request and pull out the value of the Authorization header, for example `Token f1acac96cc79c4822e9010d23ab425231d580875`.

Run `python scripts/load_incidents_v3.py --authz 'Token YOUR_AUTH_TOKEN' /path/to/directory_containing_incident_csvs`. Note that the import process will take roughly two hours for the full data set; you can cut down the number of records with `head` on the individual CSVs.

To load mock black spots, run `python scripts/load_black_spots.py --authz 'Token YOUR_AUTH_TOKEN' /path/to/black_spots.json`.

To load mock interventions, run `python scripts/load_interventions.py --authz 'Token YOUR_AUTH_TOKEN' /path/to/interventions_sample_pts.geojson`.

To generate black spot and load forecast training inputs, run `python scripts/generate_training_input.py /path/to/roads.shp /path/to/records.csv`.

## Schema relationships

pnp_incident_schema.json requires 'incidents_and_sites.csv'

pnp_incident_schema_v2.json requires 'public.csv'

incident_schema_v3.json requires the directory `data_for_v3`

load_black_spots.py requires `black_spots.json`

load_interventions.py requires `interventions_sample_pts.geojson`

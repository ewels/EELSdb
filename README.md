# EELSdb
Source code for v3 of the EELS database.

## Local Installation

### Software environment
To get the website running locally for development work, you can use conda to create
a new environment with all of the required Python dependencies:

```bash
conda env create -f conda_environment.yml
source activate eelsdb
```

This will install [Django](https://www.djangoproject.com/),
[PostgreSQL](https://www.postgresql.org/), the Python PostgreSQL connector `psycopg2`
and [Hyperspy](http://hyperspy.org/) with all dependencies.

### Database setup
First, initialise a postgres database (directories ignored in `.gitignore`)

```bash
cd /path/to/repo/eelsdb
mkdir -p postgres/data/
initdb -D postgres/data/
```

Now, we can tell conda to start up the database every time we use this conda
environment. Find the conda environment directory. For example:
```
$ which python
/Users/yourname/.miniconda/envs/eelsdb/bin/python
```

Then create conda environment variable scripts which run when the environment
is activated and deactivated

```bash
cd /Users/yourname/.miniconda/envs/eelsdb/
mkdir -p ./etc/conda/activate.d
mkdir -p ./etc/conda/deactivate.d
touch ./etc/conda/activate.d/env_vars.sh
touch ./etc/conda/deactivate.d/env_vars.sh
```

Now add the following content to `./etc/conda/activate.d/env_vars.sh`
(update the variable values according to your system / preference)
```bash
#!/bin/sh
export EELSDB_DB_NAME='eelsdb'
export EELSDB_DB_USER='eelsdb_username'
export EELSDB_DB_PASSWORD='eelsdb_password'
export EELSDB_POSTGRES='/path/to/repo/eelsdb/postgres/'
pg_ctl -D $EELSDB_POSTGRES/data/ -l $EELSDB_POSTGRES/logfile start
```

Add the following content to `./etc/conda/deactivate/env_vars.sh`
```bash
#!/bin/sh
pg_ctl -D $EELSDB_POSTGRES/data/ stop
unset EELSDB_DB_NAME
unset EELSDB_DB_USER
unset EELSDB_DB_PASSWORD
unset EELSDB_POSTGRES
```

Now deactivate and reactivate the environment. You should see a `stdout`
message saying that the Postgres server has started (`server starting`).

#### Fresh database setup
First, create a new database user:
```bash
echo $EELSDB_DB_PASSWORD | pbcopy
createuser -s $EELSDB_DB_USER --pwprompt --createdb --no-superuser --no-createrole
# paste password in prompt
```
Then create a new database:
```bash
createdb -U $EELSDB_DB_USER --locale=en_US.utf-8 -E utf-8 -O $EELSDB_DB_USER $EELSDB_DB_NAME -T template0
```

Now tell Django to create the database tables that it needs:
```bash
python manage.py migrate
```

If you want, you can see the database tables that have been created:
```
python manage.py dbshell

eelsdb=> \dt
```

#### Importing existing database
Coming soon..

#### Admin user accounts
You may need to create a new user account to access the Django admin pages
(especially if creating a new database from scratch). To do this, run the
following Django command line wizard:


### Running the webserver
You can now run the website by launching the Django development webserver:

```bash
cd eeldsb
python manage.py runserver
```

## Development Flow

### Changing Models
Changing models affects the database, and required migrations to be created
and run when you're done. After you've edited `models.py`, there are two commands
that you need to run:
```bash
python manage.py makemigrations # creates a file in migrations/ for those changes
python manage.py migrate # applies these changes to the database
```


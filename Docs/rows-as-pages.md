
Think of pages less as files, but more like versatile records, with attributes including not only standard page metadata (e.g. "Created date", "Last modified", "Visibility"), but also the properties you set in a specific page database. 

For example, let's take the 'Chlorination Readings' database. First, you design your data structure by creating database columns for the data you want to record at each test. 
    
Then, based on the database columns, you create a form which allows users to input results of the chlorine level reading into the database. 

Each form submission inserts a new row into the database. The "Created by" and "Created date" fields are populated automatically at each submission, based on the current date and the user account from which the form was submitted. 

While the underlying architecture of the application means evey row in the database is technically a page, you can disregard that fact in this use case; the database itself and attributes of pages become the point of interest. 

To make this less confusing, we can actually just disable the 'freeform' portion of the pages in this specific database. That way, users won't be able to frite freely inside the pages of this database. 

There are cases where the users might be encouraged to utilise both the attributes and freeform potion of the pages:
- In an incident report-type-situation
    - Attributes: 
        - Incident type
        - Location
        - Risk level
        - Action taken
        - Follow-up required
        - Reviewed by (more on that later)
    - Freeform:
        - Step-by-step account of the incident
        - "there is a million children running around and now they're all overly chlorinated 😭”
        - Staff response reflections
        - Preventative suggestions

The 'attributes' become the structured data, with potentially required fields, which you want to ensure remains consistent in type and/or *required field(s). The 'freeform' part becomes the messier section, where the user can provide additional details if needed. Kind of like a comment box, but structured however they want (just like any other page which they would be used to writing in their workspace). 

The 'Reviewed by' attribute then becomes interesting, because the data needs to be reviewed by a person other than who initially submitted the incident report. A second 'form' based on the database therefore needs to exist - where the second user is presented with the data input by the first user, with the ability to view the existing attributes and add additional ones. 


-- To Create Description Metadata in SQL which creates floating helper text in MinistryPlatform
EXEC sys.sp_addextendedproperty @name=N'MS_Description', @value=N'Indicates whether this contact has given express consent to receive text messages.' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'Contacts', @level2type=N'COLUMN',@level2name=N'Texting_Opt_In_Type_ID'
GO